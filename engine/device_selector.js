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
const adt = require('adt');

module.exports = new lang.Class({
    Name: 'DeviceSelector',
    Extends: events.EventEmitter,

    _init: function(engine, mode, block) {
        events.EventEmitter.call(this);

        this.engine = engine;
        this._mode = mode;
        this.block = block;
        this.channels = [];

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;
    },

    getChannels: function() {
        return Q.all(this.channels);
    },

    _onDeviceAdded: function(device) {
        if (this.block.selector === null || !this.block.selector(device))
            return;

        var args = [this.block.channelName].concat(input.channelArgs);
        var channel = device.getChannel.apply(device, args);
        this.channels.push(channel);
        channel.then(function(ch) {
            this.block.channels.push(ch);
            this.emit('channel-added', ch);
        }.bind(this)).done();
    },

    _onDeviceRemoved: function(device) {
        this.channels.forEach(function(channel) {
            Q(channel).then(function(ch) {
                if (ch.uniqueId.indexOf('-' + device.uniqueId) >= 0) {
                    var i = this.block.channels.indexOf(ch);
                    if (i >= 0)
                        this.block.channels.splice(i, 1);

                    this.emit('channel-removed', ch);
                    return ch.close().then(function() { return true; });
                } else {
                    return false;
                }
            }.bind(this)).then(function(yes) {
                if (yes) {
                    var i = this.channels.indexOf(channel);
                    if (i >= 0)
                        this.channels.splice(i, 1);
                }
            }.bind(this)).done();
        }, this);
    },

    _openChannels: function() {
        var devices = this.engine.devices.getAllDevices();
        var channels = this.engine.channels;
        var args = [this.block.channelName].concat(this.block.channelArgs);

        if (this.block.selector !== null) {
            this.channels = devices.filter(this.block.selector).map(function(device) {
                return device.getChannel.apply(device, args);
            }.bind(this));
        } else {
            // naked channel
            if (this.block.channelName.substr(0,5) === 'pipe-')
                this.channels = [channels.getNamedPipe(this.block.channelName.substr(5), mode)];
            else
                this.channels = [channels.getChannel.apply(channels, args)];
        }

        return Q.all(this.channels).then(function(channels) {
            this.block.channels = channels;
            channels.forEach(function(channel) {
                this.emit('channel-added', channel);
            }, this);
        }.bind(this));
    },

    _closeChannels: function() {
        return Q.all(this.channels.map(function(channel) {
            return Q(channel).then(function(ch) {
                return ch.close();
            });
        }));
    },

    start: function() {
        if (this.block.selector !== null) {
            this._deviceAddedListener = this._onDeviceAdded.bind(this);
            this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
            this.engine.devices.on('device-added', this._deviceAddedListener);
            this.engine.devices.on('device-removed', this._deviceRemovedListener);
        }

        return this._openChannels();
    },

    stop: function() {
        if (this._deviceAddedListener)
            this.engine.devices.removeListener('device-added', this._deviceAddedListener);
        if (this._deviceRemovedListener)
            this.engine.devices.removeListener('device-removed', this._deviceRemovedListener);

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        return this._closeChannels();
    },
});
