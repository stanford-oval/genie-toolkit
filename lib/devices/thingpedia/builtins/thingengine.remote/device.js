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

const Receive = new Tp.ChannelClass({
    Name: 'Receive',

    _init(engine, device, params) {
        this.parent(engine, device, params);
        this.principal = params[0];
        this.uuid = params[1];
        this.kindChannel = params[2];
        this.filterString = this.principal + ':' + this.uuid + ':' + this.kindChannel;
    },

    formatEvent(event, hint, formatter) {
        var [channelType, kind, channel] = this.kindChannel.split(':');

        return this.engine.remote.executeRemote(this.principal,
            ThingTalk.Ast.Selector.Device(kind, null, null), 'format-' + channelType,
            channel, event.slice(3));
    },

    _onMessage(msg) {
        if (msg === null) {
            this.__destroyTrigger = true;
            this.emitEvent(null);
        } else {
            this.emitEvent([this.principal, this.uuid, this.kindChannel].concat(msg));
        }
    },

    _doOpen() {
        this._messageListener = this._onMessage.bind(this);
        return this.engine.remote.subscribe(this.principal, this.uuid, this._messageListener);
    },

    _doClose() {
        return this.engine.remote.unsubscribe(this.principal, this.uuid, this._messageListener);
    }
});

const Send = new Tp.ChannelClass({
    Name: 'Send',

    sendEvent(event) {
        var data = event.slice(2);
        var principal = event[0];
        var uuid = event[1];
        return this.engine.remote.sendData(principal, uuid, data);
    }
});

module.exports = new Tp.DeviceClass({
    Name: 'RemoteThingEngineDevice',

    _init(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'org.thingpedia.builtin.thingengine.remote';
        this.globalName = 'remote';
        this.isTransient = true;
    },

    get remote() {
        return this.engine.remote;
    },

    getTriggerClass(name) {
        if (name === 'receive')
            return Receive;
        else
            throw new Error('Invalid action ' + name);
    },

    getActionClass(name) {
        if (name === 'send')
            return Send;
        else
            throw new Error('Invalid action ' + name);
    }
});
