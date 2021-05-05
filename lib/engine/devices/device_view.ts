// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as Tp from 'thingpedia';
import { ObjectSet } from 'thingpedia';

function like(str : string, substr : string) {
    return str.toLowerCase().indexOf(substr.toLowerCase()) >= 0;
}

// A "view" of a set of devices, as a set of selectors matching
// in specific context (which must be an ObjectSet of Devices)
export default class DeviceView extends ObjectSet.Base<Tp.BaseDevice> {
    private context : ObjectSet.Base<Tp.BaseDevice>;
    private kind : string;
    private attrs : Record<string, string>;

    private _deviceAddedListener : (device : Tp.BaseDevice) => void;
    private _deviceRemovedListener : (device : Tp.BaseDevice) => void;

    private _objects : Map<string, Tp.BaseDevice>;
    private _subviews : Map<Tp.BaseDevice, ObjectSet.Base<Tp.BaseDevice>>;

    private _dynamic : boolean;

    constructor(context : ObjectSet.Base<Tp.BaseDevice>,
                kind : string,
                attrs : Record<string, string>, dynamic = true) {
        super();

        this.context = context;
        this.kind = kind;
        this.attrs = attrs;

        this._deviceAddedListener = (o) => this._onDeviceAdded(o);
        this._deviceRemovedListener = (o) => this._onDeviceRemoved(o);

        this._objects = new Map();
        this._subviews = new Map();

        this._dynamic = dynamic;
    }

    values() {
        return Array.from(this._objects.values());
    }

    addOne(o : Tp.BaseDevice|null) {
        if (o === null)
            return;
        if (this._objects.has(o.uniqueId!))
            return;
        this._objects.set(o.uniqueId!, o);
        this.objectAdded(o);
    }

    addMany(objs : Tp.BaseDevice[]) {
        objs.forEach((o) => this.addOne(o));
    }

    removeOne(o : Tp.BaseDevice) {
        if (!this._objects.has(o.uniqueId!))
            return;
        this._objects.delete(o.uniqueId!);
        this.objectRemoved(o);
    }

    getById(id : string) {
        return this._objects.get(id);
    }

    private _matchSelector(device : Tp.BaseDevice) {
        if (!device.hasKind(this.kind))
            return false;
        if (this.attrs.principal)
            return false;
        if (this.attrs.id)
            return device.uniqueId === this.attrs.id;

        for (const key in this.attrs) {
            if (key === 'id' || key === 'principal')
                continue;

            if (!like((device as any)[key], this.attrs[key]))
                return false;
        }
        return true;
    }

    private _maybeAddSubview(device : Tp.BaseDevice) {
        const subview = device.queryInterface('subdevices');
        if (subview !== null) {
            this._subviews.set(device, subview);
            this._startSubview(subview);
            return true;
        } else {
            return false;
        }
    }

    private _maybeRemoveSubview(device : Tp.BaseDevice) {
        const subview = this._subviews.get(device);
        if (subview !== undefined) {
            this._stopSubview(subview);
            this._subviews.delete(device);
            return true;
        } else {
            return false;
        }
    }

    private _onDeviceAdded(o : Tp.BaseDevice) {
        if (this._matchSelector(o)) {
            this.addOne(o);
            return;
        }
        this._maybeAddSubview(o);
    }

    private _onDeviceRemoved(o : Tp.BaseDevice) {
        if (this._matchSelector(o))
            this.removeOne(o);
        this._maybeRemoveSubview(o);
    }

    private _startSubview(view : ObjectSet.Base<Tp.BaseDevice>) {
        if (this._dynamic) {
            view.on('object-added', this._deviceAddedListener);
            view.on('object-removed', this._deviceRemovedListener);
        }

        for (const d of view.values())
            this._onDeviceAdded(d);
    }

    private _stopSubview(view : ObjectSet.Base<Tp.BaseDevice>) {
        view.removeListener('object-added', this._deviceAddedListener);
        view.removeListener('object-removed', this._deviceRemovedListener);
    }

    async start() {
        this._startSubview(this.context);
    }

    async stop() {
        for (const v of this._subviews.values())
            this._stopSubview(v);
        this._stopSubview(this.context);
    }
}
