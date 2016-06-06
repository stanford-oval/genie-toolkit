// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const Url = require('url');
const path = require('path');
const child_process = require('child_process');

const JsonDatagramSocket = require('./json_datagram_socket');

// Manage an instance of SEMPRE running in the background, using our API

// see ../run_sempre.sh for all other arguments
const ARGS = ['-Main.streamapi', 'true'];

class Session {
    constructor(id, master) {
        this.id = id;
        this.master = master;
    }

    sendUtterance(utterance) {
        return this.master.sendUtterance(this.id, utterance);
    }
}

module.exports = class LocalSempre {
    constructor(silent) {
        this._socket = null;
        this._child = null;

        this._pending = [];
        this._silent = silent;
        this._id = 1;
    }

    start() {
        if (process.env.SEMPRE_PATH)
            var dirname = path.resolve(process.env.SEMPRE_PATH);
        else
            var dirname = path.resolve(path.dirname(module.filename), '../../sempre');
        var script = path.resolve(path.dirname(module.filename), './run_sempre.sh');
        this._child = child_process.spawn(script, ARGS,
                                          { cwd: dirname,
                                            stdio: ['pipe','pipe', (this._silent ? 'ignore' : 2)],
                                          });

        this._socket = new JsonDatagramSocket(this._child.stdout, this._child.stdin);
        this._socket.on('data', this._onData.bind(this));
    }

    stop() {
        this._child.kill();
        this._child = null;
    }

    _onData(msg) {
        if (msg.status) {
            if (msg.status === 'Ready')
                console.log('SEMPRE is now Ready');
            else
                console.log('SEMPRE reached unexpected status ' + msg.status);
            return;
        }

        if (this._pending.length === 0) {
            if (msg.error) {
                console.error("Received error from SEMPRE: ", msg.error);
                return;
            } else {
                console.error("Received unexpected message from SEMPRE");
                return;
            }
        }

        var next = this._pending.shift();
        if (msg.error)
            next.reject(new Error(msg.error));
        else
            next.resolve(msg.answer);
    }

    openSession() {
        return new Session(this._id++, this);
    }

    sendUtterance(session, utterance) {
        var msg = { session: String(session),
                    utterance: utterance };

        var defer = Q.defer();
        this._pending.push(defer);
        this._socket.write(msg);

        return defer.promise;
    }
}
