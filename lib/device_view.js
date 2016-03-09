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

    _init: function(device, context, selectors, channelName, params, mode, openContext) {
        events.EventEmitter.call(this);

        this.device = device;
        this.context = context;
        if (selectors.length <= 0)
            throw new Error('Selectors array must be non-empty');
        this.selectors = selectors;
        this.channelName = channelName;
        this.params = params;
        this.mode = mode;

        this._subviews = [];
        this._set = new ObjectSet.Simple();

        this._openContext = openContext;

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;
    },

    _deviceMatchSelector: function(device, selector) {
        if (selector.isAny) {
            return true;
        } else if (selector.isAttributes) {
            return selector.attributes.every(function(a) {
                if (a.name === 'type')
                    return device.hasKind(a.value.value);
                else if (a.name === 'id')
                    return device.uniqueId === a.value.value;
                else
                    return device.state[a.name] === a.value.value;
            });
        } else if (selector.isGlobalName) {
            return device.kind === selector.name ||
                device.globalName === selector.name;
        } else if (selector.isId) {
            return device.uniqueId === selector.name;
        } else {
            throw new Error('Invalid selector ' + selector);
        }
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
        if (!this._deviceMatchSelector(device, this.selectors[0]))
            return Q();

        if (this.selectors.length == 1) {
            // this is the last step in the traversal
            // try to open the device

            var promise;
            if (this.mode === 'r')
                promise = device.getTrigger(this.channelName, this.params);
            else
                promise = device.getAction(this.channelName, this.params);
            return this._set.addOne(promise.catch(function(e) {
                console.error('Failed to get channel ' + this.channelName +
                              ' in device ' + device.uniqueId + ': ' + e.message);
                              console.error(e.stack);
                              return null;
            }.bind(this)));
        } else {
            // we need to traverse the device
            console.log('Namespace device ' + device.uniqueId + ' matches ' + this.selectors);

            // the device could implement device-group, in which case we know semi-statically
            // what devices to match on
            var group = device.queryInterface('device-group');
            if (group !== null) {
                var subview = new DeviceView(device, group, this.selectors.slice(1),
                                             this.channelName, this.mode, this.params, false);
                return this._startSubview(subview);
            }

            // nope, this device cannot be traversed, so ignore it
            return Q();
        }
    },

    _onDeviceAdded: function(device) {
        this._deviceOpenChannels(device).catch(function(e) {
            console.log('Failed to open channels on ' + device.uniqueId + ': ' + e.message);
        }).done();
    },

    _onDeviceRemoved: function(device) {
        this._subviews = this._subviews.filter(function(subview) {
            if (subview.device === device) {
                subview.stop().catch(function(e) {
                    console.error('Failed to stop subview for device ' + device.uniqueId + ': ' + e.message);
                }).done();
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
        }.bind(this)).catch(function(e) {
            console.error('Failed to close channels for device ' + device.uniqueId + ': ' + e.message);
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
            subview.stop().catch(function(e) {
                console.error('Failed to stop subview for device ' + subview.device.uniqueId + ': ' + e.message);
            }).done();
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
            }.bind(this));
        } else {
            return this._closeChannels();
        }
    },
});
module.exports = DeviceView;
