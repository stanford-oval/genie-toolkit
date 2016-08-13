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

const Protocol = require('./protocol');

// naming: proxy is the side that requested the channel, stub is the
// side that has the implementation and is forwarding the data

const ProxyChannel = new Tp.ChannelClass({
    Name: 'ProxyChannel',

    _init: function(proxyManager, targetTier, targetChannelId, cachedArgs) {
        this.parent();
        this.uniqueId = targetChannelId;
        this.targetTier = targetTier;
        this._cachedArgs = cachedArgs;

        this._proxyManager = proxyManager;

        this._requestId = 0;
    },

    _doOpen() {
        // open is immediate and proceeds asynchronously, because we cache data locally anyway
        this._proxyManager.requestProxyChannel(this, this._cachedArgs).catch(function(e) {
            console.error('Proxy channel request for ' + this.uniqueId + ' failed: ' + e.message);
            // the stack is not meaningful here
        }.bind(this)).done();
        return Q();
    },

    _doClose() {
        this._proxyManager.releaseProxyChannel(this).catch(function(e) {
            console.error('Proxy channel release for ' + this.uniqueId + ' failed: ' + e.message);
            // the stack is not meaningful here
        }.bind(this)).done();
        return Q();
    },

    sendEvent(data) {
        return this._proxyManager.channelInvoke(this.targetTier, this.uniqueId, 'sendEvent', this._requestId++, data);
    },

    formatEvent(event, filters) {
        return this._proxyManager.channelInvoke(this.targetTier, this.uniqueId, 'formatEvent', this._requestId++, event, filters);
    },

    invokeQuery(filters) {
        return this._proxyManager.channelInvoke(this.targetTier, this.uniqueId, 'invokeQuery', this._requestId++, filters);
    }
});

class ChannelStub {
    constructor(proxyManager, targetTier, targetChannelId, innerChannel) {
        this._proxyManager = proxyManager;
        this._targetTier = targetTier;
        this._targetChannelId = targetChannelId;
        this._innerChannel = innerChannel;
        this._dataListener = null;
    }

    // called when the inner channel produced some data, we want to send it
    // back to whoever asked for us
    _onData(data) {
        this._proxyManager.sendSourceEvent(this._targetTier, this._targetChannelId, data);
    }

    get event() {
        return this._innerChannel.event;
    }

    // called when whoever asked for us is requesting to push some data into
    // the channel
    sendEvent(data) {
        this._innerChannel.sendEvent(data);
    }

    open() {
        this._dataListener = this._onData.bind(this);
        this._innerChannel.on('data', this._dataListener);
        return this._innerChannel.open();
    }

    close() {
        this._innerChannel.removeListener('data', this._dataListener);
        return this._innerChannel.close();
    }
}

module.exports = class ProxyManager {
    constructor(tierManager, channels, devices, messaging) {
        this._channels = channels;
        this._tierManager = tierManager;
        this._devices = devices;
        this._messaging = messaging;

        this._proxies = {};
        this._requests = {};
        this._stubs = {};
        this._invocations = {};

        this._tierManager.registerHandler('proxy', this._handleMessage.bind(this));
        this._tierManager.on('connected', this._onConnected.bind(this));
    }

    // if we reestablish a connection, send all subscription requests we have
    _onConnected(tier) {
        console.log(tier + ' is back online, flushing proxy channel requests');
        for (var fullId in this._requests) {
            if (this._requests[fullId].targetTier === tier)
                this._sendChannelRequest(this._requests[fullId]);
        }
    }

    _handleMessage(fromTier, msg) {
        switch (msg.op) {
        case 'request-channel':
            this._requestChannel(fromTier, msg.channelId, msg.device, msg.kind, msg.mode, msg.params);
            return;
        case 'release-channel':
            this._releaseChannel(fromTier, msg.channelId);
            return;
        case 'channel-request-complete':
            this._channelReady(fromTier, msg.channelId, msg.result, msg.event);
            return;
        case 'channel-source-data':
            this._channelSourceData(fromTier, msg.channelId, msg.data);
            return;
        case 'channel-invoke':
            this._handleChannelInvoke(fromTier, msg.channelId, msg.fn, msg.requestId, msg.data1, msg.data2);
            return;
        case 'channel-invoke-result':
            this._handleChannelInvokeResult(fromTier, msg.channelId, msg.requestId, msg.error, msg.result);
            return;
        default:
            console.log('Invalid proxy op ' + msg.op);
        }
    }

    _sendMessage(targetTier, msg) {
        // target the proxy manager of the remote tier
        msg.target = 'proxy';
        this._tierManager.sendTo(targetTier, msg);
    }

    sendSourceEvent(targetTier, targetChannelId, data) {
        this._sendMessage(targetTier, {
            op:'channel-source-data',
            channelId: targetChannelId,
            data: Protocol.params.marshal(data)
        });
    }

    _sendInvokeChannel(targetTier, targetChannelId, fn, requestId, data1, data2) {
        this._sendMessage(targetTier, {
            op:'channel-invoke',
            channelId: targetChannelId,
            fn: fn,
            requestId: requestId,
            data1: Protocol.params.marshal(data1),
            data2: Protocol.params.marshal(data2)
        });
    }

    _sendInvokeChannelReply(targetTier, targetChannelId, requestId, error, value) {
        this._sendMessage(targetTier, {
            op:'channel-invoke-result',
            channelId: targetChannelId,
            requestId: requestId,
            error: Protocol.params.marshal(error),
            value: Protocol.params.marshal(value)
        });
    }

    channelInvoke(targetTier, targetChannelId, fn, requestId, data1, data2) {
        var fullId = targetChannelId + '-' + targetTier + '-' + requestId;

        if (fullId in this._invocations)
            throw new Error('Duplicate request ID for ' + targetChannelId + ' at ' + targetTier);

        this._invocations[fullId] = Q.defer();
        this._sendInvokeChannel(targetTier, targetChannelId, fn, requestId, data1, data2);

        return this._invocations[fullId].promise;
    }

    getProxyChannel(targetChannelId, targetTier, device, kind, mode, params) {
        var fullId = targetChannelId + '-' + targetTier;

        if (fullId in this._proxies)
            return this._proxies[fullId];

        var proxy = new ProxyChannel(this, targetTier, targetChannelId, [device, kind, mode, params]);
        console.log('Created proxy channel ' + targetChannelId + ' targeting ' + targetTier);
        this._proxies[fullId] = proxy;
        return proxy;
    }

    requestProxyChannel(proxyChannel, cachedArgs) {
        var fullId = proxyChannel.uniqueId + '-' + proxyChannel.targetTier;

        var device = cachedArgs[0];
        var kind = cachedArgs[1];
        var mode = cachedArgs[2];
        var params = cachedArgs[3];

        if (device !== 'thingengine-pipe-system')
            device = device.uniqueId;

        var request = {
            defer: Q.defer(),
            device: device,
            kind: kind,
            mode: mode,
            params: Protocol.params.marshal(params),
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
    }

    _sendChannelRequest(request) {
        this._sendMessage(request.targetTier,
                          {op:'request-channel', channelId: request.targetChannelId,
                           device: request.device, kind: request.kind, mode: request.mode, params: request.params});
    }

    releaseProxyChannel(proxyChannel) {
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
    }

    _replyChannel(targetTier, targetChannelId, result, event) {
        this._sendMessage(targetTier,
                          {op:'channel-request-complete',
                           channelId:targetChannelId,
                           event:event,
                           result:result});
    }

    _requestChannel(fromTier, targetChannelId, device, kind, mode, params) {
        var fullId = targetChannelId + '-' + fromTier;

        if (fullId in this._stubs) {
            // No-op but no error
            // (can happen if the connection is flaky and one peer keeps
            // rerequesting channels)
            console.log('Duplicate channel request from ' + fromTier + ' for '
                        + targetChannelId);
            this._stubs[fullId].then(function(stub) {
                this._replyChannel(fromTier, targetChannelId, 'ok', stub.event);
            }, function(e) {
                this._replyChannel(fromTier, targetChannelId, e.message);
            });
            return;
        }

        console.log('New remote channel request for ' + targetChannelId);

        try {
            if (device !== 'thingengine-pipe-system')
                device = this._devices.getDevice(device);
            params = Protocol.params.unmarshal(this._messaging, params);
        } catch(e) {
            this._replyChannel(fromTier, targetChannelId, e.message);
            return;
        }

        var defer = Q.defer();
        this._stubs[fullId] = defer.promise;

        this._channels.getChannel(device, kind, mode, params).then(function(channel) {
            var stub = new ChannelStub(this, fromTier, targetChannelId, channel);
            return stub.open().then(function() {
                defer.resolve(stub);
            });
        }.bind(this)).catch(function(e) {
            defer.reject(e);
        });

        defer.promise.then(function(stub) {
            this._replyChannel(fromTier, targetChannelId, 'ok', stub.event);
        }, function(e) {
            this._replyChannel(fromTier, targetChannelId, e.message);
        });
    }

    _releaseChannel(fromTier, targetChannelId) {
        var fullId = targetChannelId + '-' + fromTier;

        if (!(fullId in this._stubs)) {
            console.error('Channel ' + fullId + ' was not requested');
            return;
        }

        this._stubs[fullId].then(function(stub) {
            stub.close();
        });
        delete this._stubs[fullId];
    }

    _channelReady(fromTier, targetChannelId, result, event) {
        var fullId = targetChannelId + '-' + fromTier;

        if (!(fullId in this._requests)) {
            console.error('Invalid channel reply for ' + targetChannelId);
            return;
        }

        var request = this._requests[fullId];
        var defer = request.defer;
        if (result === 'ok') {
            request.proxy.emitEvent(event);
            defer.resolve();
        } else
            defer.reject(new Error(result));
    }

    _channelSourceData(fromTier, targetChannelId, data) {
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

        proxy.emitEvent(Protocol.params.unmarshal(data));
    }

    _handleChannelInvoke(fromTier, targetChannelId, fn, requestId, data1, data2) {
        var fullId = targetChannelId + '-' + fromTier;

        if (!(fullId in this._stubs)) {
            console.error('Invalid channel-invoke message for ' + targetChannelId);
            return;
        }
        if (fn !== 'sendEvent' && fn !== 'invokeQuery' && fn !== 'formatEvent') {
            this._sendInvokeChannelReply(fromTier, targetChannelId, requestId, 'Invalid function', undefined);
            return;
        }

        this._stubs[fullId].then((stub) => {
            return stub[fn](Protocol.params.unmarshal(data1), Protocol.params.unmarshal(data2));
        }).then((result) => {
            this._sendInvokeChannelReply(fromTier, targetChannelId, requestId, undefined, result);
        }, (e) => {
            this._sendInvokeChannelReply(fromTier, targetChannelId, requestId, e.message, undefined);
        });
    }

    _handleChannelInvokeResult(fromTier, targetChannelId, requestId, error, result) {
        var fullId = targetChannelId + '-' + targetTier + '-' + requestId;

        if (!(fullId in this._invocations)) {
            console.error('Invalid channel-invoke-result message for ' + targetChannelId);
            return;
        }

        var defer = this._invocations[fullId];
        delete this._invocations[fullId];

        if (error)
            defer.reject(new Error(error));
        else
            defer.resolve(result);
    }
}

