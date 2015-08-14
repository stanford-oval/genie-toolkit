// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const lang = require('lang');
const net = require('net');
const WebSocket = require('ws');

const JsonDatagramSocket = require('./json_datagram_socket');
const Tier = require('./tier_manager').Tier;

//    phone <-> server, from the POV of a phone
// or phone <-> cloud, from the POV of the phone
// or server <-> cloud, from the POV of the server
// web sockets, client side
const ClientConnection = new lang.Class({
    Name: 'ClientConnection',
    Extends: events.EventEmitter,

    _init: function(serverAddress, authToken) {
        events.EventEmitter.call(this);
        this._serverAddress = serverAddress;
        this._authToken = authToken;
        this._closeOk = false;

        this._outgoingBuffer = [];
        this._backoffTimer = null;
        this._retryAttempts = 3;
    },

    _onConnectionLost: function() {
        if (this._closeOk)
            return;

        console.log('Lost connection to the server');
        this._socket.end();
        this._socket = null;

        // if the connection lasted less than 60 seconds, consider it
        // a failed open (subject to retry limit), otherwise reopen
        // right away

        var now = new Date;
        var retry;
        if (now.getTime() - this._backoffTimer.getTime() > 60000) {
            if (this._retryAttempts > 0) {
                this._retryAttempts--;
                retry = true;
            } else {
                retry = false;
            }
        } else {
            retry = true;
        }

        if (retry) {
            this.open().catch(function(error) {
                this.emit('failed');
            }.bind(this));
        } else {
            this.emit('failed');
        }
    },

    _onConnected: function(socket) {
        this._socket = socket;

        console.log('Successfully connected to server');

        if (this._authToken != null)
            socket.send(JSON.stringify({control:'auth', token: this._authToken}));

        this._outgoingBuffer.forEach(function(msg) {
            socket.send(msg);
        });
        this._outgoingBuffer = [];
        this._backoffTimer = new Date;
        this._retryAttempts = 3;

        this._socket.on('close', function() {
            if (socket != this._socket)
                return;

            this._onConnectionLost();
        }.bind(this));
        this._socket.on('message', function(data) {
            if (socket != this._socket)
                return;

            var msg;
            try {
                msg = JSON.parse(data);
            } catch(e) {
                console.error('Error parsing server message: ' + e);
                return;
            }

            if (data.control == 'close') {
                console.log('Server requested connection shutdown');
                this.close();
                this.emit('failed');
                return;
            }

            this.emit('message', msg);
        }.bind(this));
    },

    open: function() {
        return Q.Promise(function(callback, errback) {
            try {
                var socket = new WebSocket(this._serverAddress);
                socket.on('open', function() {
                    callback(socket);
                });
            } catch(e) {
                errback(e);
            }
        }.bind(this))
            .timeout(10000, 'Timed out')
            .then(function(socket) {
                return this._onConnected(socket);
            }.bind(this))
            .catch(function(error) {
                console.error('Failed to connect to server: ' + error);
                if (this._retryAttempts > 0) {
                    this._retryAttempts--;
                    this.open();
                } else {
                    throw e;
                }
            }.bind(this));
    },

    close: function() {
        this._socket.close();
        this._closeOk = true;
        this._socket = null;
        return Q(true);
    },

    send: function(msg) {
        if (this._socket)
            this._socket.send(JSON.stringify(msg));
        else
            this._outgoingBuffer.push(msg);
    }
});

//    phone <-> server, from the POV of a server
// or phone <-> cloud, from the POV of the cloud
// or server <-> cloud, from the POV of the cloud
// websockets endpoint, plugging in the express frontend
const ServerConnection = new lang.Class({
    Name: 'ServerConnection',
    Extends: events.EventEmitter,

    _init: function(endpoint, authToken) {
        events.EventEmitter.call(this);

        this._authToken = authToken;
        this._connections = [];
    },

    _findConnection: function(socket) {
        return this._connections.find(function(c) {
            return c.socket === socket;
        });
    },

    _handleConnection: function(socket) {
        var connection = {
            socket: socket,
            // wait for authentication
            dataOk: false,
            closeOk: false,
            closeCallback: null,
        };

        console.log('New connection from client');

        socket.on('message', function(data) {
            var connection = this._findConnection(socket);
            if (connection === undefined) // robustness
                return;

            var msg;
            try {
                msg = JSON.parse(data);
            } catch(e) {
                console.error('Error parsing client message: ' + e);
                return;
            }

            if (!connection.dataOk) {
                if (data.control !== 'auth' || data.auth !== this._authToken) {
                    console.error('Invalid authentication message');
                    socket.terminate();
                } else {
                    console.log('Client successfully authenticated');
                    connection.dataOk = true;
                }
                return;
            }

            this.emit('message', msg);
        }.bind(this));

        this._connections.push(connection);
        this.socket.on('close', function() {
            var connection = this._findConnection(socket);
            if (connection === undefined)
                return;

            this._connections.splice(this._connections.indexOf(connection), 1);
            if (connection.closeOk) {
                connection.closeCallback();
                return;
            }

            console.error('Lost connection from the client');
            connection.socket.end();
            connection.socket = null;
            connection.closeOk = false;
            connection.dataOk = false;
        }.bind(this));
    },

    open: function() {
        platform._getPrivateFeature('frontend-express').ws(endpoint, this._handleConnection.bind(this));
        return Q(true);
    },

    close: function() {
        return Q.all(this._connections.map(function(connection) {
            return Q.Promise(function(callback, errback) {
                connection.socket.send(JSON.stringify({control:'close'}));
                connection.closeOk = true;
                connection.closeCallback = callback;
            }).timeout(10000, 'ETIMEOUT').catch(function(e) {
                if (e.message != 'ETIMEOUT')
                    throw e;

                // the phone failed to close the connection within 10 seconds,
                // tear down the connection forcibly (this will cause a RST on
                // the wire)
                if (connection.socket) // robustness
                    connection.socket.terminate();
            });
        }));
    },

    send: function(msg) {
        return Q.all(this._connections.map(function(connection) {
            if (connection.socket && connection.dataOk)
                connection.socket.send(JSON.stringify(msg));
            // else
            // eat the message
            // unfortunately we don't know who will connect and when, so we can't buffer
            // forever
            // client apps should resync themselves upon new connections
        }));
    }
});
