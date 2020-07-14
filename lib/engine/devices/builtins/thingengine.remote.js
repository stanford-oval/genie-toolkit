// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const Stream = require('stream');
const Tp = require('thingpedia');

module.exports = class RemoteThingEngineDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);
        this.uniqueId = 'org.thingpedia.builtin.thingengine.remote';
        this.isTransient = true;
    }

    get remote() {
        return this.engine.remote;
    }

    subscribe_receive({ __principal, __program_id, __flow }, state) {
        let stream = new Stream.Transform({ objectMode: true, transform(data, encoding, callback) {
            if (this._destroyed) {
                callback(null);
                return;
            }

            let clone = {};
            Object.assign(clone, data);
            clone.__timestamp = new Date;
            callback(null, clone);
        }, flush(callback) {
            callback(null);
        } });
        stream._destroyed = false;
        stream.destroy = function() { this._destroyed = true; };

        this.engine.remote.subscribe(__principal, String(__program_id), __flow).then((subscription) => {
            subscription.pipe(stream);
        }, (e) => stream.emit('error', e));
        return stream;
    }

    get_receive() {
        console.error('@remote.receive called as GET, this should never happen');
        return Promise.resolve([]);
    }

    do_send(params) {
        let data = {};
        Object.assign(data, params);
        delete data.__principal;
        delete data.__flow;
        delete data.__program_id;
        let { __principal, __program_id, __flow } = params;
        return this.engine.remote.sendData(__principal, __program_id, __flow, data);
    }

};
