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

function ForeignActionClass(actionName) {
    return class ForeignAction extends Tp.BaseChannel {
        sendEvent(event) {
            console.log('Invoking remote action ' + actionName + ' on ' + this.device.principal);
            console.log('Event: ' + event);
            return this.device.remote.executeRemote(this.device.principal,
                ThingTalk.Ast.Selector.GlobalName(this.device.remoteKind),
                'action', actionName, event);
        }
    }
}

function ForeignQueryClass(queryName) {
    return class ForeignAction extends Tp.BaseChannel {
        formatEvent(event) {
            return this.device.remote.executeRemote(this.device.principal,
                ThingTalk.Ast.Selector.GlobalName(this.device.remoteKind),
                'format-query', queryName, event);
        }

        invokeQuery(filters) {
            return this.device.remote.executeRemote(this.device.principal,
                ThingTalk.Ast.Selector.GlobalName(this.device.remoteKind),
                'query', queryName, filters);
        }
    }
}

module.exports = class RemoteThingEngineDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        this.uniqueId = 'org.thingpedia.builtin.thingengine.remote-' + state.principal + '-' + state.remoteKind;
        this.isTransient = true;
    }

    get principal() {
        return this.state.principal;
    }

    get remoteKind() {
        return this.state.remoteKind;
    }

    get remote() {
        return this.engine.remote;
    }

    getTriggerClass(name) {
        throw new Error('Invalid trigger ' + name);
    }

    getActionClass(name) {
        return ForeignActionClass(name);
    }

    hasKind(kind) {
        if (kind === this.remoteKind)
            return true;
        return super.hasKind(kind);
    }
}
