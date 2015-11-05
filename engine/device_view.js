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

    _init: function(device, context, selectors, mode, filters, openContext) {
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

        this._openContext = openContext;

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

    _startSubview: function(subview) {
        return subview.start().then(function(subset) {
            subset.on('object-added', function(ch) {
                // add an 'open' reference that we will match on _onDeviceRemoved
                ch.open().then(function() {
                    return this._set.addOne(ch);
                }.bind(this)).done();
            }.bind(this));
            subset.on('object-removed', function(ch) {
                // match the reference we got on channel-added
                ch.close().then(function() {
                    return this._set.removeOne(ch);
                }.bind(this)).done();
            }.bind(this));
            this._subviews.push(subview);

            return this._set.addMany(subset.values());
        }.bind(this));
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
            console.log('Namespace device ' + device.uniqueId + ' matches ' + this.selectors);

            // the device could implement device-group, in which case we know semi-statically
            // what devices to match on
            var group = device.queryInterface('device-group');
            if (group !== null) {
                var subview = new DeviceView(device, group, this.selectors.slice(1),
                                             this.mode, this.filters, false);
                return this._startSubview(subview);
            }

            // the device could implement shared-device-group, in which case we either recognize
            // -> #members to mean the member list, -> #shareddata to mean the feed itself,
            // or -> <anythingelse> to mean some subset of devices shared in the group
            var group = device.queryInterface('shared-device-group');
            if (group !== null) {
                // BLARGH I hate that we have this special-special-special case
                if (this.selectors.length === 2 && this.selectors[1].length === 1 &&
                    this.selectors[1][0].isTag && this.selectors[1][0] === 'sharedData') {
                    if (this.mode === 'r')
                        return this._set.addOne(device.getChannel('source', this.filters));
                    else
                        return this._set.addOne(device.getChannel('sink', this.filters));
                }

                if (this.selectors[1].length === 1 &&
                    this.selectors[1][0].isTag && this.selectors[1][0] === 'members') {
                    // given 'S1 -> #members -> S2', where S1 is what we're currently maching
                    // get the thingengine object set and construct a subview that matches
                    // '* -> S2' on the thingengine object set
                    var engines = group.getMemberEngines();
                    // simple selectors are AND-ed together, so an empty simple selector matches
                    // everything
                    var subview = new DeviceView(device, engines, [[]].concat(this.selectors.slice(2)),
                                                 this.mode, this.filters, true);
                    return this._startSubview(subview);
                }

                // The remaining case: open all devices that have been shared with the group
                // The group actually does not contain devices, it contains RemoteGroupProxies
                // Hence we go from 'S1 -> S2' to 'S1 -> * -> S2' where * matches the RemoteGroupProxy
                var proxies = group.getSharedGroups();
                var subview = new DeviceView(device, proxies, [[]].concat(this.selectors.slice(1)),
                                             this.mode, this.filters, true);
                return this._startSubview(subview);
            }

            // the device could implement device-channel-proxy, in which case we delegate
            // the channel fully
            var proxy = device.queryInterface('device-channel-proxy');
            if (proxy !== null) {
                return this._set.addOne(proxy.getChannel(this.selectors.slice(1), this.mode, this.filters));
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
                subview.stop().done();
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
        this._subviews.forEach(function(subview) {
            subview.stop().done();
        });

        return this._set.promise().then(function() {
            var removed = this._set.removeAll();

            return Q.all(removed.map(function(ch) {
                return ch.close();
            }));
        }.bind(this));
    },

    start: function() {
        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this.context.on('object-added', this._deviceAddedListener);
        this.context.on('object-removed', this._deviceRemovedListener);

        if (this._openContext) {
            return this.context.open().then(function() {
                return this._openChannels();
            }.bind(this));
        } else {
            return this._openChannels();
        }
    },

    stop: function() {
        if (this._deviceAddedListener)
            this.context.removeListener('object-added', this._deviceAddedListener);
        if (this._deviceRemovedListener)
            this.context.removeListener('object-removed', this._deviceRemovedListener);

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        if (this._openContext) {
            return this._closeChannels().then(function() {
                return this.context.close();
            });
        } else {
            return this._closeChannels();
        }
    },
});
module.exports = DeviceView;
