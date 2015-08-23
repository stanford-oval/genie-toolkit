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

const user = require('./model/user');
const db = require('./util/db');

var _instance = null;

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
                    return Q.all([Q.nfcall(fs.open, './' + cloudId + '/out.log', 'a'),
                                  Q.nfcall(fs.open, './' + cloudId + '/err.log', 'a')])
                })
            .spread(function(stdout, stderr) {
                var env = {};
                for (var name in process.env)
                    env[name] = process.env[name];
                env.CLOUD_ID = cloudId;
                env.AUTH_TOKEN = authToken;
                console.log('Spawning child for user ' + userId);
                var child = child_process.fork(path.dirname(module.filename)
                                               + '/instance/runengine', [],
                                               { cwd: './' + cloudId,
                                                 stdio: ['ignore',stdout,stderr],
                                                 env: env });
                fs.close(stdout);
                fs.close(stderr);

                child.on('error', function(error) {
                    console.error('Child with ID ' + userId + ' reported an error: ' + error);
                });
                child.on('exit', function(code, signal) {
                    if (code !== 0)
                        console.error('Child with ID ' + userId + ' exited with code ' + code);

                    delete runningProcesses[userId];
                });
                runningProcesses[userId] = child;

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
            var child = this._runningProcesses[userId];
            child.kill();
        }
    },
});

EngineManager.get = function() {
    return _instance;
};

module.exports = EngineManager;
