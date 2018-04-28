// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');
const Tp = require('thingpedia');

module.exports = class RemoteThingEngineDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);
        this.uniqueId = 'org.thingpedia.builtin.thingengine.remote';
        this.isTransient = true;

        this.name = engine._("Remote ThingSystem");
        this.description = engine._("This service allows you to interact with devices and accounts that belong to other people (with their permission).");
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
