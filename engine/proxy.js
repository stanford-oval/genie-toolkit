// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const lang = require('lang');

const Protocol = require('./protocol');
const BaseChannel = require('./base_channel');

// naming: proxy is the side that requested the channel, stub is the
// side that has the implementation and is forwarding the data

const ProxyChannel = new lang.Class({
    Name: 'ProxyChannel',
    Extends: BaseChannel,

    _init: function(proxyManager, targetTier, targetChannelId, cachedArgs) {
        this.parent();
        this.uniqueId = targetChannelId;
        this.targetTier = targetTier;
        this._cachedArgs = cachedArgs;

        this._proxyManager = proxyManager;
    },

    _doOpen: function() {
        // open is immediate and proceeds asynchronously, because we cache data locally anyway
        this._proxyManager.requestProxyChannel(this, this._cachedArgs).done();
        return Q();
    },

    _doClose: function() {
        this._proxyManager.releaseProxyChannel(this).done();
        return Q();
    },

    sendEvent: function(data) {
        this._proxyManager.sendSinkEvent(this.targetTier, this.uniqueId, data);
    }
});

const ChannelStub = new lang.Class({
    Name: 'ChannelStub',

    _init: function(proxyManager, targetTier, innerChannel) {
        this._proxyManager = proxyManager;
        this._targetTier = targetTier;
        this._innerChannel = innerChannel;
        this._dataListener = null;
    },

    // called when the inner channel produced some data, we want to send it
    // back to whoever asked for us
    _onData: function(data) {
        this._proxyManager.sendSourceEvent(this._targetTier, this._innerChannel.uniqueId, data);
    },

    _onNextTick: function() {
        this._proxyManager.sendSourceNextTick(this._targetTier, this._innerChannel.uniqueId);
    },

    get previousEvent() {
        return this._innerChannel.previousEvent;
    },

    get event() {
        return this._innerChannel.event;
    },

    // called when whoever asked for us is requesting to push some data into
    // the channel
    sendEvent: function(data) {
        this._innerChannel.sendEvent(data);
    },

    open: function() {
        this._dataListener = this._onData.bind(this);
        this._innerChannel.on('data', this._dataListener);

        this._nextTickListener = this._onNextTick.bind(this);
        this._innerChannel.on('next-tick', this._nextTickListener);

        return this._innerChannel.open();
    },

    close: function() {
        this._innerChannel.removeListener('data', this._dataListener);
        this._innerChannel.removeListener('next-tick', this._nextTickListener);
        return this._innerChannel.close();
    },
});

module.exports = new lang.Class({
    Name: 'ProxyManager',

    _init: function(tierManager, channels, devices) {
        this._channels = channels;
        this._tierManager = tierManager;
        this._devices = devices;

        this._proxies = {};
        this._requests = {};
        this._stubs = {};

        this._tierManager.registerHandler('proxy', this._handleMessage.bind(this));
        this._tierManager.on('connected', this._onConnected.bind(this));
    },

    // if we reestablish a connection, send all subscription requests we have
    _onConnected: function(tier) {
        console.log(tier + ' is back online, flushing proxy channel requests');
        for (var fullId in this._requests) {
            if (this._requests[fullId].targetTier === tier)
                this._sendChannelRequest(this._requests[fullId]);
        }
    },

    _handleMessage: function(fromTier, msg) {
        switch (msg.op) {
        case 'request-channel':
            this._requestChannel(fromTier, msg.channelId, msg.device, msg.kind, msg.filters);
            return;
        case 'release-channel':
            this._releaseChannel(fromTier, msg.channelId);
            return;
        case 'channel-request-complete':
            this._channelReady(fromTier, msg.channelId, msg.result, msg.event, msg.previousEvent);
            return;
        case 'channel-source-data':
            this._channelSourceData(fromTier, msg.channelId, msg.data);
            return;
        case 'channel-source-next-tick':
            this._channelSourceNextTick(fromTier, msg.channelId);
            return;
        case 'channel-sink-data':
            this._channelSinkData(fromTier, msg.channelId, msg.data);
            return;
        default:
            console.log('Invalid proxy op ' + msg.op);
        }
    },

    _sendMessage: function(targetTier, msg) {
        // target the proxy manager of the remote tier
        msg.target = 'proxy';
        this._tierManager.sendTo(targetTier, msg);
    },

    sendSourceEvent: function(targetTier, targetChannelId, data) {
        this._sendMessage(targetTier, {op:'channel-source-data', channelId: targetChannelId,data:data});
    },

    sendSourceNextTick: function(targetTier, targetChannelId) {
        this._sendMessage(targetTier, {op:'channel-source-next-tick', channelId: targetChannelId});
    },

    sendSinkEvent: function(targetTier, targetChannelId, data) {
        this._sendMessage(targetTier, {op:'channel-sink-data', channelId: targetChannelId,data:data});
    },

    getProxyChannel: function(targetChannelId, targetTier, device, kind, filters) {
        var fullId = targetChannelId + '-' + targetTier;

        if (fullId in this._proxies)
            return this._proxies[fullId];

        var proxy = new ProxyChannel(this, targetTier, targetChannelId, [device, kind, filters]);
        console.log('Created proxy channel ' + targetChannelId + ' targeting ' + targetTier);
        this._proxies[fullId] = proxy;
        return proxy;
    },

    requestProxyChannel: function(proxyChannel, cachedArgs) {
        var fullId = proxyChannel.uniqueId + '-' + proxyChannel.targetTier;

        var device = cachedArgs[0];
        var kind = cachedArgs[1];
        var filters = cachedArgs[2];

        if (device !== 'thingengine-internal')
            device = device.uniqueId;

        var request = {
            defer: Q.defer(),
            device: device,
            kind: kind,
            filters: Protocol.filters.marshal(filters),
            proxy: proxyChannel,
            targetChannelId: proxyChannel.uniqueId,
            targetTier: proxyChannel.targetTier,
        };
        this._requests[fullId] = request;

        if (this._tierManager.isConnected(request.targetTier)) {
            console.log(request.targetTier + ' is connected, sending proxy'
                        + ' channel request now');
            this._sendChannelRequest(request);
        } else {
            console.log('Delaying proxy channel request until ' + request.targetTier
                        + ' is connected');
        }

        return this._requests[fullId].defer.promise;
    },

    _sendChannelRequest: function(request) {
        this._sendMessage(request.targetTier,
                          {op:'request-channel', channelId: request.targetChannelId,
                           device: request.device, kind: request.kind, filters: request.filters});
    },

    releaseProxyChannel: function(proxyChannel) {
        var fullId = proxyChannel.uniqueId + '-' + proxyChannel.targetTier;
        if (!(fullId in this._requests)) {
            console.error('Cannot release a channel that was not requested');
            return;
        }
        delete this._requests[fullId];

        this._sendMessage(proxyChannel.targetTier,
                          {op:'release-channel', channelId:
                           proxyChannel.uniqueId});
        return Q(true);
    },

    _replyChannel: function(targetTier, targetChannelId, result, event, previousEvent) {
        this._sendMessage(targetTier,
                          {op:'channel-request-complete',
                           channelId:targetChannelId,
                           event:event,
                           previousEvent:previousEvent,
                           result:result});
    },

    _requestChannel: function(fromTier, targetChannelId, device, kind, filters) {
        var fullId = targetChannelId + '-' + fromTier;

        if (fullId in this._stubs) {
            // No-op but no error
            // (can happen if the connection is flaky and one peer keeps
            // rerequesting channels)
            console.log('Duplicate channel request from ' + fromTier + ' for '
                        + targetChannelId);
            this._stubs[fullId].then(function(stub) {
                this._replyChannel(fromTier, targetChannelId, 'ok', stub.event, stub.previousEvent);
            }, function(e) {
                this._replyChannel(fromTier, targetChannelId, e.message);
            });
            return;
        }

        console.log('New remote channel request for ' + targetChannelId);

        try {
            if (device !== 'thingengine-internal')
                device = this._devices.getDevice(device);
            kind = kind;
            filters = Protocol.filters.unmarshal(this._devices, filters);
        } catch(e) {
            this._replyChannel(fromTier, targetChannelId, e.message);
            return;
        }

        var defer = Q.defer();
        this._stubs[fullId] = defer.promise;

        this._channels.getChannel(device, kind, filters).then(function(channel) {
            var stub = new ChannelStub(this, fromTier, channel);
            return stub.open().then(function() {
                defer.resolve(stub);
            });
        }.bind(this)).catch(function(e) {
            defer.reject(e);
        });

        defer.promise.then(function(stub) {
            this._replyChannel(fromTier, targetChannelId, 'ok', stub.event, stub.previousEvent);
        }, function(e) {
            this._replyChannel(fromTier, targetChannelId, e.message);
        });
    },

    _releaseChannel: function(fromTier, targetChannelId) {
        var fullId = targetChannelId + '-' + fromTier;

        if (!(fullId in this._stubs)) {
            console.error('Channel ' + fullId + ' was not requested');
            return;
        }

        this._stubs[fullId].then(function(stub) {
            stub.close();
        });
        delete this._stubs[fullId];
    },

    _channelReady: function(fromTier, targetChannelId, result, event, previousEvent) {
        var fullId = targetChannelId + '-' + fromTier;

        if (!(fullId in this._requests)) {
            console.error('Invalid channel reply for ' + targetChannelId);
            return;
        }

        var request = this._requests[fullId];
        var defer = request.defer;
        if (result === 'ok') {
            request.proxy.setPreviousEvent(previousEvent);
            request.proxy.setCurrentEvent(event);
            defer.resolve();
        } else
            defer.reject(new Error(result));
    },

    _channelSourceData: function(fromTier, targetChannelId, data) {
        var fullId = targetChannelId + '-' + fromTier;

        if (!(fullId in this._proxies)) {
            console.error('Invalid data message from ' + targetChannelId);
            return;
        }

        var proxy = this._proxies[fullId];
        if (proxy.targetTier !== fromTier) {
            console.error('Message sender tier does not match expected for ' + proxy.uniqueId);
            return;
        }

        proxy.emitEvent(data);
    },

    _channelSourceNextTick: function(fromTier, targetChannelId) {
        var fullId = targetChannelId + '-' + fromTier;

        if (!(fullId in this._proxies)) {
            console.error('Invalid data message from ' + targetChannelId);
            return;
        }

        var proxy = this._proxies[fullId];
        if (proxy.targetTier !== fromTier) {
            console.error('Message sender tier does not match expected for ' + proxy.uniqueId);
            return;
        }

        proxy.nextTick();
    },

    _channelSinkData: function(fromTier, targetChannelId, data) {
        var fullId = targetChannelId + '-' + fromTier;

        if (!(fullId in this._stubs)) {
            console.error('Invalid data message for ' + targetChannelId);
            return;
        }

        this._stubs[fullId].then(function(stub) {
            stub.sendEvent(data);
        });
    }
});

