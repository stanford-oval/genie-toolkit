// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const child_process = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const events = require('events');
const rpc = require('transparent-rpc');

const user = require('./model/user');
const db = require('./util/db');

var _instance = null;

const ChildProcessSocket = new lang.Class({
    Name: 'ChildProcessSocket',
    Extends: events.EventEmitter,

    _init: function(child) {
        events.EventEmitter.call(this);

        this._child = child;

        child.on('message', function(message) {
            if (message.type !== 'rpc')
                return;

            this.emit('data', message.data);
        }.bind(this));
    },

    setEncoding: function() {},

    end: function() {
        this.emit('end');
    },

    close: function() {
        this.emit('close', false);
    },

    write: function(data, encoding, callback) {
        this._child.send({type: 'rpc', data: data }, null, callback);
    }
});

const EngineManager = new lang.Class({
    Name: 'EngineManager',

    _init: function(frontend) {
        this._runningProcesses = {};
        this._frontend = frontend;

        _instance = this;
    },

    _runUser: function(userId, cloudId, authToken) {
        var runningProcesses = this._runningProcesses;
        var frontend = this._frontend;

        return Q.nfcall(fs.mkdir, './' + cloudId)
            .catch(function(e) {
                if (e.code !== 'EEXIST')
                    throw e;
            })
            .then(function() {
                var env = {};
                for (var name in process.env)
                    env[name] = process.env[name];
                env.CLOUD_ID = cloudId;
                env.AUTH_TOKEN = authToken;
                console.log('Spawning child for user ' + userId);
                var child = child_process.fork(path.dirname(module.filename)
                                               + '/instance/runengine', [],
                                               { cwd: './' + cloudId,
                                                 silent: true,
                                                 env: env });
                child.stdin.end();
                function output(where) {
                    return (function(data) {
                        var str = data.toString('utf8');
                        str.split('\n').forEach(function(line) {
                            var trimmed = line.trim();
                            if (trimmed.length > 0)
                                where('Child ' + userId + ': ' + trimmed);
                        });
                    });
                }
                child.stdout.on('data', output(console.log));
                child.stderr.on('data', output(console.error));

                child.on('error', function(error) {
                    console.error('Child with ID ' + userId + ' reported an error: ' + error);
                });
                child.on('exit', function(code, signal) {
                    if (code !== 0)
                        console.error('Child with ID ' + userId + ' exited with code ' + code);

                    delete runningProcesses[userId];
                });

                var engineProxy = Q.defer();
                runningProcesses[userId] = { child: child,
                                             engine: engineProxy.promise };

                // wrap child into something that looks like a Stream
                // (readable + writable), at least as far as JsonDatagramSocket
                // is concerned
                var socket = new ChildProcessSocket(child);
                var rpcSocket = new rpc.Socket(socket);
                var rpcStub = {
                    $rpcMethods: ['setEngine'],

                    setEngine: function(engine) {
                        console.log('Received engine from child ' + userId);

                        // precache .apps, .devices, .channels instead of querying the
                        // engine all the time, to reduce IPC latency
                        Q.all([engine.apps, engine.devices, engine.channels]).spread(function(apps, devices, channels) {
                            engineProxy.resolve({ apps: apps,
                                                  devices: devices,
                                                  channels: channels });
                        }, function(err) {
                            engineProxy.reject(err);
                        });
                    }
                };
                var rpcId = rpcSocket.addStub(rpcStub);
                child.send({ type:'rpc-ready', id: rpcId });

                frontend.registerWebSocketEndpoint('/ws/' + cloudId, function(req, socket, head) {
                    var saneReq = {
                        httpVersion: req.httpVersion,
                        url: req.url,
                        headers: req.headers,
                        rawHeaders: req.rawHeaders,
                        method: req.method,
                    };
                    var encodedReq = new Buffer(JSON.stringify(saneReq)).toString('base64');
                    child.send({type:'websocket', request: encodedReq,
                                upgradeHead: head.toString('base64')}, socket);
                });
            });
    },

    getEngine: function(userId) {
        var process = this._runningProcesses[userId];
        if (process === undefined)
            throw new Error(userId + ' is not running');

        return process.engine;
    },

    start: function() {
        var self = this;
        return db.withClient(function(client) {
            return user.getAll(client).then(function(rows) {
                return Q.all(rows.map(function(r) {
                    return self._runUser(r.id, r.cloud_id, r.auth_token);
                }));
            });
        });
    },

    startUser: function(userId, cloudId, authToken) {
        console.log('Requested start of user ' + userId);
        return this._runUser(userId, cloudId, authToken);
    },

    stop: function() {
        for (var userId in this._runningProcesses) {
            var child = this._runningProcesses[userId].child;
            child.kill();
        }
    },
});

EngineManager.get = function() {
    return _instance;
};

module.exports = EngineManager;
