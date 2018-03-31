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

const Q = require('q');
const Tp = require('thingpedia');

class Receive extends Tp.BaseChannel {
    constructor(engine, device, params) {
        super(engine, device);
        this.principal = params[0];
        this.programId = params[1];
        this.flow = params[2];
        this.filterString = this.principal + ':' + this.programId + ':'+ this.flow;
        this._subscription = null;
    }

    _doOpen() {
        this._dataListener = (data) => this.emit('data', [this.principal, this.programId, this.flow].concat(data));
        this._endListener = () => this.emit('end');

        return this.engine.remote.subscribe(this.principal, this.programId, this.flow).then((subscription) => {
            subscription.on('data', this._dataListener);
            subscription.on('end', this._endListener);
            this._subscription = subscription;
        });
    }

    _doClose() {
        this._subscription.removeListener('data', this._dataListener);
        this._subscription.removeListener('end', this._endListener);
        return Q();
    }
}

class Send extends Tp.BaseChannel {
    sendEvent(event) {
        let data = event.slice(3);
        let principal = event[0];
        let programId = event[1];
        let flow = event[2];
        return this.engine.remote.sendData(principal, programId, flow, data);
    }
}

module.exports = class RemoteThingEngineDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);
        this.uniqueId = 'org.thingpedia.builtin.thingengine.remote';
        this.globalName = 'remote';
        this.isTransient = true;
    }

    get remote() {
        return this.engine.remote;
    }

    getTriggerClass(name) {
        if (name === 'receive')
            return Receive;
        else
            throw new Error('Invalid action ' + name);
    }

    getActionClass(name) {
        if (name === 'send')
            return Send;
        else
            throw new Error('Invalid action ' + name);
    }
};
