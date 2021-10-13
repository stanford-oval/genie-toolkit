// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import * as Tp from 'thingpedia';
import * as events from 'events';
import WebSocket from 'ws';

//    phone <-> server, from the POV of a phone
// or phone <-> cloud, from the POV of the phone
// or server <-> cloud, from the POV of the server
// web sockets, client side
class ClientConnection extends events.EventEmitter {
    private _serverAddress : string;
    private _identity : string;
    private _authToken : string;

    private _closeOk : boolean;
    private _outgoingBuffer : any[];
    private _ratelimitTimer : Date|null;
    private _retryAttempts : number;
    private _socket : WebSocket|null;

    isClient : boolean;
    isServer : boolean;

    constructor(serverAddress : string, identity : string, authToken : string) {
        super();
        this._serverAddress = serverAddress;
        this._identity = identity;
        this._authToken = authToken;
        this._closeOk = false;

        this._outgoingBuffer = [];
        this._ratelimitTimer = null;
        this._retryAttempts = 3;
        this._socket = null;

        this.isClient = true;
        this.isServer = false;
    }

    private _onConnectionLost() {
        if (this._closeOk)
            return;

        console.log('Lost connection to the server');
        this._socket = null;

        // if the connection lasted less than 60 seconds, consider it
        // a failed open (subject to retry limit), otherwise reopen
        // right away

        const now = new Date;
        let retry;
        if (now.getTime() - this._ratelimitTimer!.getTime() < 60000) {
            if (this._retryAttempts > 0)
                retry = true;
            else
                retry = false;
        } else {
            retry = true;
            this._retryAttempts = 3;
        }

        if (retry) {
            this.open().catch((error) => {
                this.emit('failed', this._outgoingBuffer);
            });
        } else {
            this.emit('failed', this._outgoingBuffer);
        }
    }

    private _onConnected(socket : WebSocket) {
        this._socket = socket;

        // setup keep-alives
        socket.on('ping', () => socket.pong());

        if (this._authToken !== undefined) {
            socket.send(JSON.stringify({ control:'auth',
                                        identity: this._identity,
                                        token: this._authToken }));
        }

        this._outgoingBuffer.forEach((msg) => {
            if (msg.control === undefined)
                msg.control = 'data';
            socket.send(msg);
        });
        this._outgoingBuffer = [];

        this._ratelimitTimer = new Date;

        this._socket.on('close', () => {
            if (socket !== this._socket)
                return;

            this._onConnectionLost();
        });
        this._socket.on('message', (data : string) => {
            if (socket !== this._socket)
                return;

            let msg;
            try {
                msg = JSON.parse(data);
            } catch(e) {
                console.error('Error parsing server message: ' + e);
                return;
            }

            // The control messages we expect to receive
            if (['auth-token-ok', 'auth-token-error',
                 'data', 'close'].indexOf(msg.control) < 0) {
                console.error('Invalid control message ' + msg.control);
                // ignore the message, don't die (back/forward compatibility)
                return;
            }

            if (msg.control === 'close') {
                console.log('Server requested connection shutdown');
                this.close();
                this.emit('failed', this._outgoingBuffer);
                return;
            }

            if (msg.control === 'data')
                delete msg.control;

            this.emit('message', msg);
        });
    }

    async open() : Promise<boolean> {
        this._retryAttempts--;
        try {
            const socket = await new Promise<WebSocket>((callback, errback) => {
                const socket = new WebSocket(this._serverAddress);
                socket.on('open', () => {
                    callback(socket);
                });
                socket.on('error', errback);
                setTimeout(() => {
                    errback(new Error('Timed out'));
                }, 10000);
            });
            await this._onConnected(socket);
            return true;
        } catch(error) {
            if (this._retryAttempts > 0) {
                return this.open();
            } else {
                this.emit('failed', this._outgoingBuffer);
                return false;
            }
        }
    }

    close() {
        this._socket!.close();
        this._closeOk = true;
        this._socket = null;
        return Promise.resolve();
    }

    send(msg : any) {
        if (this._socket) {
            try {
                if (msg.control === undefined)
                    msg.control = 'data';
                this._socket.send(JSON.stringify(msg));
            } catch(e) {
                console.error('Failed to send message on websocket: ' + e.message);
                this._outgoingBuffer.push(msg);
            }
        } else {
            this._outgoingBuffer.push(msg);
        }
    }

    sendMany(buffer : any[]) {
        buffer.forEach((msg) => this.send(msg));
    }
}

interface ConnectionRecord {
    socket : WebSocket|null;
    identity : string|undefined;
    dataOk : boolean;
    closeOk : boolean;
    closeCallback : (() => void)|null;
    pingTimeout : NodeJS.Timeout|null;
    outgoingBuffer : any[];
}

//    phone <-> server, from the POV of a server
// or phone <-> cloud, from the POV of the cloud
// or server <-> cloud, from the POV of the cloud
// on server: websockets endpoint, plugging in the express frontend
// on cloud: websockets server on Unix domain socket (proxied from frontend)
class ServerConnection extends events.EventEmitter {
    private _connections : Record<string, ConnectionRecord>;
    private _platform : Tp.BasePlatform;

    isClient : boolean;
    isServer : boolean;

    constructor(platform : Tp.BasePlatform) {
        super();

        this._connections = {};
        this._platform = platform;

        this.isClient = false;
        this.isServer = true;
    }

    isConnected(remote : string) {
        return this._connections[remote] !== undefined &&
            this._connections[remote].socket !== null;
    }

    private _findConnection(socket : WebSocket) {
        for (const id in this._connections) {
            if (this._connections[id].socket === socket)
                return this._connections[id];
        }
        return undefined;
    }

    private _handleConnection(socket : WebSocket) {
        const connection : ConnectionRecord = {
            socket: socket,
            identity: undefined,
            // wait for authentication
            dataOk: false,
            closeOk: false,
            closeCallback: null,
            pingTimeout: null,
            outgoingBuffer: [],
        };

        // setup keep-alives
        socket.on('ping', () => socket.pong());

        socket.on('message', (data : string) => {
            let msg;
            try {
                msg = JSON.parse(data);
            } catch(e) {
                console.error('Error parsing client message: ' + e);
                return;
            }

            if (!connection.dataOk) {
                if (msg.control !== 'auth' || typeof msg.identity !== 'string' ||
                    msg.token === undefined || // this covers the case of getAuthToken returning undefined
                    msg.token !== this._platform.getAuthToken()) {
                    console.log('Invalid authentication message');
                    socket.terminate();
                } else {
                    connection.dataOk = true;

                    connection.identity = msg.identity as string;
                    const oldConnection = this._connections[connection.identity];
                    if (oldConnection) {
                        if (oldConnection.socket)
                            oldConnection.socket.terminate();
                        if (oldConnection.pingTimeout !== null)
                            clearInterval(oldConnection.pingTimeout);
                    }
                    this._connections[connection.identity] = connection;

                    // Send a ping every 30m
                    // ngnix frontend is configured to timeout the connection
                    // after 1h, so this should keep it alive forever, without
                    // a noticeable performance impact
                    connection.pingTimeout = setInterval(() => {
                        if (connection.socket)
                            connection.socket.ping();
                    }, 1800 * 1000);

                    if (oldConnection && oldConnection.outgoingBuffer)
                        this.sendMany(oldConnection.outgoingBuffer, connection.identity);

                    this.emit('connected', msg.identity);
                }
                return;
            } else {
                if (this._findConnection(socket) === undefined) // robustness
                    return;

                if (msg.control !== 'data') {
                    console.log('Invalid control message ' + msg.control);
                    // ignore the message, don't die (back/forward compatibility)
                    return;
                }

                delete msg.control;
            }

            this.emit('message', msg, connection.identity);
        });

        socket.on('close', () => {
            const connection = this._findConnection(socket);
            if (connection === undefined)
                return;

            if (connection.pingTimeout !== null)
                clearInterval(connection.pingTimeout);

            if (connection.closeOk) {
                if (connection.closeCallback)
                    connection.closeCallback();
                return;
            }

            console.error('Lost connection from client with identity ' + connection.identity);

            connection.socket = null;
            connection.closeOk = false;
            connection.dataOk = false;
        });
    }

    open() {
        const capability = this._platform.getCapability('websocket-api');
        if (capability !== null) {
            capability.on('connection', this._handleConnection.bind(this));
            return Promise.resolve(true);
        } else {
            return Promise.resolve(false);
        }
    }

    close() {
        return Promise.all(Object.keys(this._connections).map((id) => this.closeOne(id)));
    }

    closeOne(identity : string) {
        const connection = this._connections[identity];
        if (!connection)
            return Promise.resolve();

        return new Promise<void>((callback, errback) => {
            if (connection.socket !== null) {
                connection.socket.send(JSON.stringify({ control:'close' }));
                connection.closeOk = true;
                connection.closeCallback = callback;
            } else {
                connection.closeOk = false;
                connection.closeCallback = null;
                callback();
            }
            setTimeout(() => {
                const err : Error & { code ?: string } = new Error('Timed out');
                err.code = 'ETIMEOUT';
                errback(err);
            });
        }).catch((e) => {
            if (e.code !== 'ETIMEOUT')
                throw e;

            // the phone failed to close the connection within 10 seconds,
            // tear down the connection forcibly (this will cause a RST on
            // the wire)
            if (connection.socket) // robustness
                connection.socket.terminate();
        });
    }

    private _sendTo(msg : any, to : string) {
        const connection = this._connections[to];
        if (connection === undefined)
            throw new Error('Invalid destination for server message');

        if (connection.socket && connection.dataOk) {
            if (msg.control === undefined)
                msg.control = 'data';
            connection.socket.send(JSON.stringify(msg));
        } else {
            connection.outgoingBuffer.push(msg);
        }
    }

    send(msg : any, to ?: string) {
        if (to !== undefined) {
            this._sendTo(msg, to);
            return;
        }

        for (const id in this._connections)
            this._sendTo(msg, id);
    }

    sendMany(buffer : any[], to ?: string) {
        buffer.forEach((msg) => this.send(msg, to));
    }
}

export {
    ClientConnection,
    ServerConnection
};
