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
        this.filters = block.filters || [];

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;
    },

    getChannels: function() {
        return Q.all(this.channels);
    },

    _deviceMatchSelector: function(device, selector) {
        if (selector.isTag)
            return device.hasKind(selector.name) || device.hasTag(selector.name);
        else
            return device.uniqueId === selector.name;
    },

    _deviceGetChannels: function(device, selectors) {
        var i;

        // thingengine-system is the special device that
        // contains the standard channels like #logger, #timer and #pipe
        // we special case it so that it does not eat useful tags
        if (!device.hasKind('thingengine-system')) {
            // tag matching is greedy, and it goes in order
            // device -> contact -> channel
            for (i = 0; i < selectors.length; i++) {
                if (!this._deviceMatchSelector(device, selectors[i]))
                    break;
            }

            // if none of the selectors match, then we reject the device
            if (i === 0)
                return [];
        }

        // if all selectors match, we pick the default channel names
        if (i === selectors.length) {
            if (this._mode == 'r')
                return [device.getChannel('source', this.filters)];
            else
                return [device.getChannel('sink', this.filters)];
        }

        // one or more of the selectors were not matched - they could be
        // contacts or named channels
        // (pipes are handled like contacts, SystemDevice implements
        // object-store)

        var objectStore = device.queryInterface('object-store');
        if (objectStore !== null) {
            var channels = device.getObjectChannels(selectors.slice(i), this._mode, this.filters);
            if (Array.isArray(channels))
                return channels;
            else
                // FINISHME handle the case of returning some dynamic view
                throw new Error('Cannot (yet) handle dynamic view of device objects');
        }

        // if exactly one selector is missing, and it is a tag selector,
        // try a named channel
        if (i === selectors.length - 1 && selectors[i].isTag)
            return device.getChannel(selectors[i].name, this.filters);

        // reject the device
        return [];
    },

    _deviceOpenChannels: function(device) {
        var channels = this._deviceGetChannels(device, this.block.selectors);

        channels = channels.map(function(promise) {
            return Q(promise).then(function(ch) {
                this.block.channels.push(ch);
                this.emit('channel-added', ch);
            }.bind(this)).catch(function(e) {
                // eat the error silently
            });
        }, this);

        this.channels = this.channels.concat(channels);
        return channels;
    },

    _onDeviceAdded: function(device) {
        Q.all(this._deviceOpenChannels(device)).done();
    },

    _onDeviceRemoved: function(device) {
        this.channels.forEach(function(channel) {
            Q(channel).then(function(ch) {
                if (ch.uniqueId.startsWith(device.uniqueId + '-')) {
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
        var promises = devices.map(function(device) {
            return Q.all(this._deviceOpenChannels(device));
        }.bind(this));

        return Q.all(promises);
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
