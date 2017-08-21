// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Tier = Tp.Tier;
const Protocol = require('../tiers/protocol');
const ChannelStateDatabase = require('../db/channel');
const RefCounted = require('../util/ref_counted');

class ChannelStateBinder extends RefCounted {
    constructor(db) {
        super();
        this._db = db;
        this._cached = {};
        this.uniqueId = null;
        this._updateTimeout = null;
    }

    init(uniqueId) {
        this.uniqueId = uniqueId;
    }

    get(name) {
        return this._cached[name];
    }

    set(name, value) {
        this._cached[name] = value;

        clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(this._flushToDisk.bind(this), 500);
    }

    _flushToDisk() {
        this._updateTimeout = null;

        return this._db.insertOne(this.uniqueId, this._cached);
    }

    _doOpen() {
        return this._db.getOne(this.uniqueId).then(function(value) {
            if (value !== null)
                this._cached = value;
            else
                this._cached = {};
        }.bind(this));
    }

    _doClose() {
        clearTimeout(this._updateTimeout);
        return this._flushToDisk();
    }
}

module.exports = class ChannelFactory {
    constructor(engine, devices) {
        this._engine = engine;
        this._cachedChannels = {};

        this._devices = devices;
        this._proxyManager = null;

        this._db = new ChannelStateDatabase(engine.platform);
    }

    set proxyManager(v) {
        this._proxyManager = v;
    }

    _onDeviceRemoved(device) {
        var prefix = device.uniqueId + '-';
        for (var key in this._cachedChannels) {
            if (key.startsWith(prefix))
                this._cachedChannels[key].state.close();
                delete this._cachedChannels[key];
        }
    }

    start() {
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this._devices.on('object-removed', this._deviceRemovedListener);
        return Q();
    }

    stop() {
        this._devices.removeListener('object-removed', this._deviceRemovedListener);
        return Q();
    }

    _getProxyChannel(targetTier, device, name, mode, params) {
        var targetChannelId = device.uniqueId + '-' + name;
        if (mode === 'r')
            targetChannelId += '-' + Protocol.params.makeString(params);

        return this._proxyManager.getProxyChannel(targetChannelId, targetTier,
                                                  device, name, mode, params);
    }

    _checkFactoryCaps(caps) {
        return caps.every(function(c) {
            if (c === 'channel-state')
                return true;
            else
                return this._engine.platform.hasCapability(c);
        }.bind(this));
    }

    getChannel(device, name, mode, params) {
        return Q.try(function() {
            switch (mode) {
            case 'r':
                return device.getTriggerClass(name);
            case 'q':
                return device.getQueryClass(name);
            case 'w':
                return device.getActionClass(name);
            default:
                throw new Error('Invalid mode ' + mode);
            }

            var caps = factory.requiredCapabilities || [];
            if (!this._checkFactoryCaps(caps))
                throw new Error('Channel is not supported');

            var hasState = caps.indexOf('channel-state') >= 0;
            var channel;
            // all channels have state, but for compat reasons we pass
            // the state to the constructor only if the channel declares
            // the channel-state capability
            var state = new ChannelStateBinder(this._db);
            if (hasState)
                channel = new factory(this._engine, state, device, params || []);
            else
                channel = new factory(this._engine, device, params || []);

            if (channel.filterString !== undefined)
                channel.uniqueId = device.uniqueId + '-' + name + '-' + channel.filterString;
            else
                channel.uniqueId = device.uniqueId + '-' + name;
            // make sure channel.device is properly set
            if (!channel.device)
                channel.device = device;
            channel.setState(state);
            channel.name = name;
            switch(mode) {
            case 'r':
                channel.channelType = 'trigger';
                break;
            case 'w':
                channel.channelType = 'action';
                break;
            case 'q':
                channel.channelType = 'query';
                break;
            }

            console.log('Obtained channel ' + channel.uniqueId);

            // deduplicate the channel now that we have the uniqueId
            if (channel.uniqueId in this._cachedChannels)
                return this._cachedChannels[channel.uniqueId];

            state.init(channel.uniqueId);
            this._cachedChannels[channel.uniqueId] = channel;
            return state.open().then(() => channel);
        }.bind(this));
    }

    _getOpenedChannel(promise) {
        return Q(promise).tap(function(channel) {
            return channel.open();
        });
    }

    getOpenedChannel(device, id, mode, params) {
        if (device.ownerTier === this._engine.ownTier ||
            device.ownerTier === Tier.GLOBAL)
            return this._getOpenedChannel(this.getChannel(device, id, mode, params));
        else
            return this._getOpenedChannel(this._getProxyChannel(device.ownerTier, device, id, mode, params));
    }
}
