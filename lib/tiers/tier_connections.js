// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const WebSocket = require('ws');

//    phone <-> server, from the POV of a phone
// or phone <-> cloud, from the POV of the phone
// or server <-> cloud, from the POV of the server
// web sockets, client side
class ClientConnection extends events.EventEmitter {
    constructor(serverAddress, identity, targetIdentity, authToken) {
        super();
        this._serverAddress = serverAddress;
        this._identity = identity;
        this._targetIdentity = targetIdentity;
        this._authToken = authToken;
        this._closeOk = false;

        this._outgoingBuffer = [];
        this._ratelimitTimer = null;
        this._retryAttempts = 3;

        this.isClient = true;
        this.isServer = false;
    }

    _onConnectionLost() {
        if (this._closeOk)
            return;

        console.log('Lost connection to the server');
        this._socket = null;

        // if the connection lasted less than 60 seconds, consider it
        // a failed open (subject to retry limit), otherwise reopen
        // right away

        let now = new Date;
        let retry;
        if (now.getTime() - this._ratelimitTimer.getTime() < 60000) {
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

    _onConnected(socket) {
        this._socket = socket;

        // setup keep-alives
        socket.on('ping', () => socket.pong());

        if (this._authToken !== undefined) {
            socket.send(JSON.stringify({control:'auth',
                                        identity: this._identity,
                                        token: this._authToken}));
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
        this._socket.on('message', (data) => {
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

        return Promise.resolve(true);
    }

    open() {
        this._retryAttempts--;
        return new Promise((callback, errback) => {
            let socket = new WebSocket(this._serverAddress);
            socket.on('open', () => {
                callback(socket);
            });
            socket.on('error', errback);
            setTimeout(() => {
                errback(new Error('Timed out'));
            }, 10000);
        }).then((socket) => {
            return this._onConnected(socket);
        }).catch((error) => {
            if (this._retryAttempts > 0) {
                return this.open();
            } else {
                this.emit('failed', this._outgoingBuffer);
                return false;
            }
        });
    }

    close() {
        this._socket.close();
        this._closeOk = true;
        this._socket = null;
        return Q();
    }

    send(msg) {
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

    sendMany(buffer) {
        buffer.forEach((msg) => this.send(msg));
    }
}

//    phone <-> server, from the POV of a server
// or phone <-> cloud, from the POV of the cloud
// or server <-> cloud, from the POV of the cloud
// on server: websockets endpoint, plugging in the express frontend
// on cloud: websockets server on Unix domain socket (proxied from frontend)
class ServerConnection extends events.EventEmitter {
    constructor(platform, expected) {
        super();

        this._connections = {};
        this._platform = platform;

        expected.forEach((from) => {
            this._connections[from] = { socket: null, dataOk: false, closeOk: false,
                                        closeCallback: null, outgoingBuffer: [] };
        });

        this.isClient = false;
        this.isServer = true;
    }

    isConnected(remote) {
        return this._connections[remote] !== undefined &&
            this._connections[remote].socket !== null;
    }

    _findConnection(socket) {
        for (let id in this._connections) {
            if (this._connections[id].socket === socket)
                return this._connections[id];
        }
        return undefined;
    }

    _handleConnection(socket) {
        let connection = {
            socket: socket,
            // wait for authentication
            dataOk: false,
            closeOk: false,
            closeCallback: null,
            pingTimeout: -1,
            outgoingBuffer: [],
        };

        // setup keep-alives
        socket.on('ping', () => socket.pong());

        socket.on('message', (data) => {
            let msg;
            try {
                msg = JSON.parse(data);
            } catch(e) {
                console.error('Error parsing client message: ' + e);
                return;
            }

            if (!connection.dataOk) {
                if (msg.control === 'set-auth-token') {
                    // initial setup mode
                    if (msg.token
                        && this._platform.setAuthToken(String(msg.token))) {
                        // note: we accept a set-auth-token command even
                        // if we have a token already configured, this
                        // simplifies the pairing logic on the phone side

                        socket.send(JSON.stringify({control:'auth-token-ok'}));
                        connection.socket = null;
                        connection.closeOk = true;
                        connection.dataOk = false;
                        connection.closeCallback = null;
                    } else {
                        console.log('Invalid initial setup message');
                        socket.send(JSON.stringify({control:'auth-token-error'}));
                        connection.socket = null;
                        connection.closeOk = true;
                        connection.dataOk = false;
                        connection.closeCallback = null;
                    }
                } else if (msg.control !== 'auth' || typeof msg.identity !== 'string' ||
                           msg.token === undefined || // this covers the case of getAuthToken returning undefined
                           msg.token !== this._platform.getAuthToken()) {
                    console.log('Invalid authentication message');
                    socket.terminate();
                } else {
                    connection.dataOk = true;

                    connection.identity = msg.identity;
                    let oldConnection = this._connections[connection.identity];
                    if (oldConnection) {
                        if (oldConnection.socket)
                            oldConnection.socket.terminate();
                        if (oldConnection.pingTimeout !== -1)
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

            if (connection.pingTimeout !== -1)
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
        let capability = this._platform.getCapability('websocket-api');
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

    closeOne(identity) {
        let connection = this._connections[identity];
        if (!connection)
            return Promise.resolve();

        return new Promise((callback, errback) => {
            if (connection.socket !== null) {
                connection.socket.send(JSON.stringify({control:'close'}));
                connection.closeOk = true;
                connection.closeCallback = callback;
            } else {
                connection.closeOk = false;
                connection.closeCallback = null;
                callback();
            }
            setTimeout(() => {
                let err = new Error('Timed out');
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

    _sendTo(msg, to) {
        let connection = this._connections[to];
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

    send(msg, to) {
        if (to !== undefined) {
            this._sendTo(msg, to);
            return;
        }

        for (let id in this._connections)
            this._sendTo(msg, id);
    }

    sendMany(buffer, to) {
        buffer.forEach((msg) => this.send(msg, to));
    }
}

module.exports = {
    ClientConnection: ClientConnection,
    ServerConnection: ServerConnection
};
