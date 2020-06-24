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

const Tp = require('thingpedia');
const ObjectSet = Tp.ObjectSet;

function like(str, substr) {
    return str.toLowerCase().indexOf(substr.toLowerCase()) >= 0;
}

// A "view" of a set of devices, as a set of selectors matching
// in specific context (which must be an ObjectSet of Devices)
module.exports = class DeviceView extends ObjectSet.Base {
    constructor(context, kind, attrs, dynamic = true) {
        super();

        this.context = context;
        this.kind = kind;
        this.attrs = attrs;

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        this._objects = new Map();
        this._subviews = new Map();

        this._dynamic = dynamic;
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

    _matchSelector(device) {
        if (!device.hasKind(this.kind))
            return false;
        if (this.attrs.principal)
            return false;
        if (this.attrs.id)
            return device.uniqueId === this.attrs.id;

        for (let key in this.attrs) {
            if (key === 'id' || key === 'principal')
                continue;

            if (!like(device[key], this.attrs[key]))
                return false;
        }
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
        if (this._dynamic) {
            view.on('object-added', this._deviceAddedListener);
            view.on('object-removed', this._deviceRemovedListener);
        }

        for (var d of view.values())
            this._onDeviceAdded(d);
    }

    _stopSubview(view) {
        view.removeListener('object-added', this._deviceAddedListener);
        view.removeListener('object-removed', this._deviceRemovedListener);
    }

    start() {
        if (this._dynamic) {
            this._deviceAddedListener = (o) => this._onDeviceAdded(o);
            this._deviceRemovedListener = (o) => this._onDeviceRemoved(o);
        }

        this._startSubview(this.context);
    }

    stop() {
        for (var v of this._subviews.values())
            this._stopSubview(v);
        this._stopSubview(this.context);
    }
};
