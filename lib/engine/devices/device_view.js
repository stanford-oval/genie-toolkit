// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
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
        let subview = device.queryInterface('subdevices');
        if (subview !== null) {
            this._subviews.set(device, subview);
            this._startSubview(subview);
            return true;
        } else {
            return false;
        }
    }

    _maybeRemoveSubview(device) {
        let subview = this._subviews.get(device);
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

        for (let d of view.values())
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
        for (let v of this._subviews.values())
            this._stopSubview(v);
        this._stopSubview(this.context);
    }
};
