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
        super(engine, device, params);
        this.uuid = params[0];
        this.filterString = this.uuid;
    }

    _onMessage(msg) {
        this.emitEvent([this.uuid].concat(msg));
    }

    _doOpen() {
        this._messageListener = this._onMessage.bind(this);
        return this.engine.remote.subscribe(this.device.principal, this.uuid, this._messageListener);
    }

    _doClose() {
        return this.engine.remote.unsubscribe(this.device.principal, this.uuid, this._messageListener);
    }
}

class Send extends Tp.BaseChannel {
    sendEvent(event) {
        var data = event.slice(1);
        var uuid = event[0];
        return this.engine.remote.sendData(this.device.principal, uuid, data);
    }
}

module.exports = class RemoteThingEngineDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        this.uniqueId = 'org.thingpedia.builtin.thingengine.remote-' + state.principal;
        this.isTransient = true;
    }

    get principal() {
        return this.state.principal;
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
