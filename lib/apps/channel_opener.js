// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Tp = require('thingpedia');
const ObjectSet = Tp.ObjectSet;

const DeviceView = require('../devices/device_view');

module.exports = class ChannelOpener extends ObjectSet.Base {
    constructor(engine, app, channelType, selector, channelName, params) {
        super();

        this.engine = engine;
        this.app = app;
        this._channelType = channelType;
        this._channelName = channelName;
        this._normalizeSelector(selector);
        this._params = params || [];

        this._set = new ObjectSet.Simple();
        this._set.on('object-added', (o) => this.objectAdded(o));
        this._set.on('object-removed', (o) => this.objectRemoved(o));
    }

    values() {
        return this._set.values();
    }

    start() {
        this._view.start();
        this._view.on('object-added', this._onDeviceAdded.bind(this));
        this._view.on('object-removed', this._onDeviceRemoved.bind(this));

        return this._openChannels();
    }

    stop() {
        this._view.stop();
        return this._closeChannels();
    }

    _openChannels() {
        var devices = this._view.values();
        var promises = devices.map((device) => {
            return this._openOneChannel(device);
        });

        return Q.all(promises);
    }

    _closeChannels() {
        var removed = this._set.removeAll();

        return Q.all(removed.map(function(ch) {
            return ch.close();
        }));
    }

    _normalizeSelector(selector, channelName) {
        if (this.app && selector.isBuiltin && this._channelName === 'new_record') {
            this._view = new ObjectSet.Simple();
            this._view.addOne(this.app);
        } else {
            assert(selector.isDevice);
            if (this.app && selector.kind === 'org.thingpedia.builtin.thingengine.builtin' && this._channelName === 'timer') {
                // special handling @builtin.timer to have separate timers for separate rules, instead of
                // a global timer
                this._view = new ObjectSet.Simple();
                this._view.addOne(this.app);
            } else {
                this._view = new DeviceView(this.engine.devices, selector);
            }
        }
    }

    _openOneChannel(device) {
        // try to open the device
        var promise;
        if (this._channelType === 'trigger')
            promise = device.getTrigger(this._channelName, this._params);
        else if (this._channelType === 'query')
            promise = device.getQuery(this._channelName);
        else if (this._channelType === 'action')
            promise = device.getAction(this._channelName);
        else
            throw new TypeError('Invalid mode');

        return this._set.addOne(promise.catch((e) => {
            console.error('Failed to get channel ' + this._channelName +
                          ' in device ' + device.uniqueId + ': ' + e.message);
            console.error(e.stack);
            return null;
        }));
    }

    _onDeviceAdded(device) {
        this._openOneChannel(device).done();
    }

    _onDeviceRemoved(device) {
        var removed = this._set.removeIf(function(ch) {
            return ch.uniqueId.startsWith(device.uniqueId + '-');
        });

        Q.all(removed.map(function(ch) {
            return ch.close();
        })).catch(function(e) {
            console.error('Failed to close channels for device ' + device.uniqueId + ': ' + e.message);
        }).done();
    }
}
