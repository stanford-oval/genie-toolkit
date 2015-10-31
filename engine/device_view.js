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

const ObjectSet = require('./object_set');

// A "view" of a set of devices (or their channels really), as a set of selectors matching
// in specific context (which must be an ObjectSet of Devices)
const DeviceView = new lang.Class({
    Name: 'DeviceView',
    Extends: events.EventEmitter,

    _init: function(device, context, selectors, mode, filters) {
        events.EventEmitter.call(this);

        this.device = device;
        this.context = context;
        this.selectors = selectors;
        if (selectors.length <= 0)
            throw new Error('Selectors array must be non-empty');
        this.mode = mode;
        this.filters = filters;

        this._subviews = [];
        this._set = new ObjectSet.Simple();

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;
    },

    _deviceMatchOneSimpleSelector: function(device, selector) {
        if (selector.isTag)
            return device.hasKind(selector.name) || device.hasTag(selector.name);
        else if (selector.isId)
            return device.uniqueId === selector.name;
        else // @self and @global should have been lowered by now, as should have @variables...
            throw new Error('Invalid selector ' + selector);
    },

    _deviceOpenChannels: function(device) {
        var i;
        // this is the list of tags/ids at our step in the traversal
        var simpleSelectors = this.selectors[0];

        for (i = 0; i < simpleSelectors.length; i++) {
            if (!this._deviceMatchOneSimpleSelector(device, simpleSelectors[i]))
                return Q();
        }

        if (this.selectors.length == 1) {
            // this is the last step in the traversal
            // try to open the device

            if (this.mode === 'r')
                return this._set.addOne(device.getChannel('source', this.filters));
            else
                return this._set.addOne(device.getChannel('sink', this.filters));
        } else {
            // we need to traverse the device
            // the device could implement device-group, in which case we know semi-statically
            // what devices to match on

            var group = device.queryInterface('device-group');
            if (group !== null) {
                var subview = new DeviceView(device, group, this.selectors.slice(1),
                                             this.mode, this.filters);
                return subview.open().then(function(subset) {
                    subset.on('channel-added', function(ch) {
                        // add an 'open' reference that we will match on _onDeviceRemoved
                        ch.open().then(function() {
                            return this._set.addOne(ch);
                        }).done();
                    }.bind(this));
                    subset.on('channel-removed', function(ch) {
                        // match the reference we got on channel-added
                        ch.close().then(function() {
                            return this._set.removeOne(ch);
                        }).done();
                    }.bind(this));
                    this._subviews.push(subview);

                    return this._set.addMany(subset.values());
                }.bind(this));
            }

            // the device could implement device-channel-proxy, in which case we delegate
            // the channel fully
            var proxy = device.queryInterface('device-channel-proxy');
            if (proxy !== null) {
                return proxy.open(this.selectors.slice(1), this.mode, this.filters)
                    .then(function(ch) {
                        return this._set.addOne(ch);
                    });
            }

            // nope, this device cannot be traversed, so ignore it
            return Q();
        }
    },

    _onDeviceAdded: function(device) {
        this._deviceOpenChannels(device).done();
    },

    _onDeviceRemoved: function(device) {
        this._subviews = this._subviews.filter(function(subview) {
            if (subview.device === device) {
                subview.close().done();
                return false;
            } else {
                return true;
            }
        });

        this._set.promise().then(function() {
            var removed = this._set.removeIf(function(ch) {
                return ch.uniqueId.startsWith(device.uniqueId + '-');
            });

            return Q.all(removed.map(function(ch) {
                return ch.close();
            }));
        }).done();
    },

    _openChannels: function() {
        var devices = this.context.values();
        var promises = devices.map(function(device) {
            return this._deviceOpenChannels(device);
        }.bind(this));

        return Q.all(promises).then(function() {
            return this._set.promise();
        }.bind(this)).then(function() {
            return this._set;
        }.bind(this));
    },

    _closeChannels: function() {
        return this._set.promise().then(function() {
            var removed = this._set.removeAll();

            return Q.all(removed.map(function(ch) {
                return ch.close();
            }));
        });
    },

    start: function() {
        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this.context.on('object-added', this._deviceAddedListener);
        this.context.on('object-removed', this._deviceRemovedListener);

        return this._openChannels();
    },

    stop: function() {
        if (this._deviceAddedListener)
            this.context.removeListener('object-added', this._deviceAddedListener);
        if (this._deviceRemovedListener)
            this.context.removeListener('object-removed', this._deviceRemovedListener);

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        return this._closeChannels();
    },
});
module.exports = DeviceView;
