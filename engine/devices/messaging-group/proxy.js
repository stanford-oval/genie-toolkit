// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const Protocol = require('../../protocol');
const BaseChannel = require('../../base_channel');

const MessagingGroupProxyChannel = new lang.Class({
    Name: 'MessagingGroupProxyChannel',
    Extends: BaseChannel,

    _init: function(engine, device, targetDeviceId, selectors, channelName, mode, filters) {
        this.parent();

        this.engine = engine;
        this._device = device;
        this._targetDeviceId = targetDeviceId;
        this._selectors = selectors;
        this._channelName = channelName;
        this._mode = mode;
        this._filters = filters;
        this._values = {};
        this._ready = {};
        this._readyCount = -1;

        this.filterString = targetDeviceId + '-' + Protocol.selectors.makeString(selectors) + '-' +
            channelName + '-' + mode + Protocol.filters.makeString(filters);
    },

    values: function() {
        var values = [];
        for (var k in this._values) {
            if (Array.isArray(this._values[k]))
                values = values.concat(this._values[k]);
            else
                values.push(this._values[k]);
        }
        return values;
    },

    sendEvent: function(event) {
        console.log('Sending broadcast event on group chat', event);
        this._feed.sendItem({ op: 'sink-data',
                              subscription: this._subscriptionId,
                              data: event });
    },

    _onNewMessage: function(msg) {
        try {
            if (!msg.text)
                return;
            var parsed = JSON.parse(msg.text);
            if (parsed.subscription !== this._subscriptionId)
                return;

            console.log('Received Omlet message: ', parsed);

            switch(parsed.op) {
            case 'subscribe-error':
                console.log("Subscription failed: " + parsed.msg);
                break;
            case 'source-data':
                if (!(msg.senderId in this._values))
                    this._values[msg.senderId] = {};
                if (parsed.data !== undefined)
                    this._values[msg.senderId][parsed.channelId] = parsed.data;
                else
                    delete this._values[msg.senderId][parsed.channelId];
                if (this._readyCount === 0)
                    this.emitEvent(this.values());
                break;
            case 'source-ready':
                if (!this._ready[msg.senderId]) {
                    this._ready[msg.senderId] = true;
                    this._readyCount--;
                }
                if (this._readyCount === 0)
                    this.emitEvent(this.values());
                break;
            case 'sink-ready':
                if (!this._ready[msg.senderId]) {
                    this._ready[msg.senderId] = true;
                    this._readyCount--;
                }
                break;
            default:
                // ignore other messages (eg. unsubscribe)
                break;
            }
        } catch(e) {
            if (e.name === 'SyntaxError')
                console.log('Failed to parse incoming Omlet on proxy feed message: ' + e);
            else
                throw e;
        }
    },

    _doOpen: function() {
        this._msgListener = this._onNewMessage.bind(this);
        this._feed = this.engine.messaging.getFeed(this._device.feedId);
        this._feed.on('incoming-message', this._msgListener);
        return this._feed.open().then(function() {
            return this._feed.getMembers();
        }.bind(this)).then(function(members) {
            this._ready = {};
            // 1 is myself, and I don't want to count me
            this._readyCount = members.length-1;
            return this.engine.subscriptions.sendSubscribe(this._feed,
                                                           this._targetDeviceId,
                                                           null, // auth based on group not token
                                                           this._selectors,
                                                           this._channelName,
                                                           this._mode,
                                                           this._filters);
        }.bind(this)).then(function(subscriptionId) {
            this._subscriptionId = subscriptionId;
        }.bind(this));
    },

    _doClose: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        this.engine.subscriptions.sendUnsubscribe(this._feed, this._subscriptionId);
        this._feed.close();
    },
});

function createChannel(engine, device, targetDeviceId, selectors, channelName, mode, filters) {
    return new MessagingGroupProxyChannel(engine, device, targetDeviceId, selectors, channelName, mode, filters);
}
module.exports.createChannel = createChannel;
