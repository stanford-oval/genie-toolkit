// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');

const ObjectSet = require('./object_set');

// A "view" of a set of devices (or their channels really), as a set of selectors matching
// in specific context (which must be an ObjectSet of Devices)
module.exports = class DeviceView extends events.EventEmitter {
    constructor(context, selector, channelName, params, mode) {
        super();

        this.context = context;
        this.selector = selector;
        this.channelName = channelName;
        this.params = params;
        this.mode = mode;

        this._set = new ObjectSet.Simple();

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;
    }

    _deviceMatchSelector(device, selector) {
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
    }

    _deviceOpenChannels(device) {
        if (!this._deviceMatchSelector(device, this.selector))
            return Q();

        // try to open the device
        var promise;
        if (this.mode === 'r')
            promise = device.getTrigger(this.channelName, this.params);
        else if (this.mode === 'q')
            promise = device.getQuery(this.channelName, this.params);
        else if (this.mode === 'w')
            promise = device.getAction(this.channelName, this.params);
        else
            throw new TypeError('Invalid mode');
        return this._set.addOne(promise.catch(function(e) {
            console.error('Failed to get channel ' + this.channelName +
                          ' in device ' + device.uniqueId + ': ' + e.message);
            console.error(e.stack);
            return null;
        }.bind(this)));
    }

    _onDeviceAdded(device) {
        this._deviceOpenChannels(device).catch(function(e) {
            console.log('Failed to open channels on ' + device.uniqueId + ': ' + e.message);
        }).done();
    }

    _onDeviceRemoved(device) {
        this._set.then(function() {
            var removed = this._set.removeIf(function(ch) {
                return ch.uniqueId.startsWith(device.uniqueId + '-');
            });

            return Q.all(removed.map(function(ch) {
                return ch.close();
            }));
        }.bind(this)).catch(function(e) {
            console.error('Failed to close channels for device ' + device.uniqueId + ': ' + e.message);
        }).done();
    }

    _openChannels() {
        var devices = this.context.values();
        var promises = devices.map(function(device) {
            return this._deviceOpenChannels(device);
        }.bind(this));

        return Q.all(promises).then(function() {
            return this._set;
        }.bind(this));
    }

    _closeChannels() {
        return this._set.then(function() {
            var removed = this._set.removeAll();

            return Q.all(removed.map(function(ch) {
                return ch.close();
            }));
        }.bind(this));
    }

    start() {
        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this.context.on('object-added', this._deviceAddedListener);
        this.context.on('object-removed', this._deviceRemovedListener);

        return this._openChannels();
    }

    stop() {
        if (this._deviceAddedListener)
            this.context.removeListener('object-added', this._deviceAddedListener);
        if (this._deviceRemovedListener)
            this.context.removeListener('object-removed', this._deviceRemovedListener);

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        return this._closeChannels();
    }
}
