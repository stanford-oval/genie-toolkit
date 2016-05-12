// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const Tp = require('thingpedia');
const ObjectSet = Tp.ObjectSet;

// A "view" of a set of devices, as a set of selectors matching
// in specific context (which must be an ObjectSet of Devices)
module.exports = class DeviceView extends ObjectSet.Simple {
    constructor(context, selector) {
        super();

        this.context = context;
        this.selector = selector;

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        this._subviews = new Map();
    }

    values() {
        return this.context.values().filter((o) => this._matchSelector(o));
    }

    _matchSelector(device) {
        if (this.selector.isAny) {
            return true;
        } else if (this.selector.isAttributes) {
            return this.selector.attributes.every(function(a) {
                if (a.name === 'type')
                    return device.hasKind(a.value.value);
                else if (a.name === 'id')
                    return device.uniqueId === a.value.value;
                else
                    return device[a.name] === a.value.value;
            });
        } else if (this.selector.isGlobalName) {
            return device.kind === this.selector.name ||
                device.globalName === this.selector.name;
        } else if (this.selector.isId) {
            return device.uniqueId === this.selector.name;
        } else {
            throw new Error('Invalid selector ' + this.selector);
        }
    }

    _maybeAddSubview(device) {
        var subview = device.queryInterface('subdevices');
        if (subview !== null) {
            this._subviews.set(device, subview);
            this._startSubview(subview);
            return true;
        } else {
            return false;
        }
    }

    _maybeRemoveSubview(device) {
        var subview = this._subviews.get(device);
        if (subview !== undefined) {
            this._stopSubview(subview);
            this._subviews.delete(device);
            return true;
        } else {
            return false;
        }
    }

    _onDeviceAdded(o) {
        if (this._maybeAddSubview(o))
            return;
        if (this._matchSelector(o))
            this.addOne(o);
    }

    _onDeviceRemoved(o) {
        if (this._maybeRemoveSubview(o))
            return;
        if (this._matchSelector(o))
            this.removeOne(o);
    }

    _startSubview(view) {
        view.on('object-added', this._deviceAddedListener);
        view.on('object-removed', this._deviceRemovedListener);

        for (var d of view.values())
            this._onDeviceAdded(d);
    }

    _stopSubview(view) {
        view.removeListener('object-added', this._deviceAddedListener);
        view.removeListener('object-removed', this._deviceRemovedListener);
    }

    start() {
        this._deviceAddedListener = (o) => this._onDeviceAdded(o);
        this._deviceRemovedListener = (o) => this._onDeviceRemoved(o);

        this._startSubview(this.context);
    }

    stop() {
        for (var v of this._subviews.values())
            this._stopSubview(v);
        this._stopSubview(this.context);
    }
}
