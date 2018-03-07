// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const Tp = require('thingpedia');
const ObjectSet = Tp.ObjectSet;

// A "view" of a set of devices, as a set of selectors matching
// in specific context (which must be an ObjectSet of Devices)
module.exports = class DeviceView extends ObjectSet.Base {
    constructor(context, selector) {
        super();

        this.context = context;
        this.selector = selector;

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        this._objects = new Map();
        this._subviews = new Map();
    }

    values() {
        return Array.from(this._objects.values());
    }

    addOne(o) {
        if (o === null)
            return;
        if (this._objects.has(o.uniqueId))
            return;
        this._objects.set(o.uniqueId, o);
        this.objectAdded(o);
    }

    addMany(objs) {
        objs.forEach((o) => this.addOne(o));
    }

    removeOne(o) {
        if (!this._objects.has(o.uniqueId))
            return;
        this._objects.delete(o.uniqueId);
        this.objectRemoved(o);
    }

    getById(id) {
        return this._objects.get(id);
    }

    removeById(id) {
        if (!this._objects.has(id))
            return;
        var old = this._objects.get(id);
        this._objects.delete(id);
        this.objectRemoved(old);
    }

    removeIf(predicate) {
        var removed = [];
        for (var entry of this._objects) {
            var key = entry[0];
            var value = entry[1];
            if (predicate(value)) {
                removed.push(value);
                this._objects.delete(key);
                this.objectRemoved(value);
            }
        }

        return removed;
    }

    removeAll() {
        var removed = this.values();
        this._objects.clear();
        for (var o of removed)
            this.objectRemoved(o);
        return removed;
    }

    _matchSelector(device) {
        if (!device.hasKind(this.selector.kind))
            return false;
        if (this.selector.principal)
            return false;
        if (this.selector.id)
            return device.uniqueId === this.selector.id;
        else
            return true;
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
        if (this._matchSelector(o)) {
            this.addOne(o);
            return;
        }
        this._maybeAddSubview(o);
    }

    _onDeviceRemoved(o) {
        if (this._matchSelector(o))
            this.removeOne(o);
        this._maybeRemoveSubview(o);
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
