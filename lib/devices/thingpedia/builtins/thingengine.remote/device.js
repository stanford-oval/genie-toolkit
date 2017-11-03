// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

class Receive extends Tp.BaseChannel {
    constructor(engine, device, params) {
        super(engine, device);
        this.principal = params[0];
        this.uuid = params[1];
        this.filterString = this.principal + ':' + this.uuid;
    }

    _onMessage(msg) {
        if (msg === null) {
            this.emit('end');
        } else {
            this.emitEvent([this.principal, this.uuid].concat(msg));
        }
    }

    _doOpen() {
        this._messageListener = this._onMessage.bind(this);
        return this.engine.remote.subscribe(this.principal, this.uuid, this._messageListener);
    }

    _doClose() {
        return this.engine.remote.unsubscribe(this.principal, this.uuid, this._messageListener);
    }
}

class Send extends Tp.BaseChannel {
    sendEvent(event) {
        var data = event.slice(2);
        var principal = event[0];
        var uuid = event[1];
        return this.engine.remote.sendData(principal, uuid, data);
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
}
