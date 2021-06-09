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

import DeviceView from './device_view';

/**
 * An helper class over {@link DeviceView} that automatically maps
 * each device to a custom object (typically retrieved from {@link Tp.BaseDevice.queryInterface})
 */
export default class DeviceInterfaceMapper<T> {
    private _view : DeviceView;
    private _mapper : (device : Tp.BaseDevice) => T;
    private _deviceAddedListener : (device : Tp.BaseDevice) => void;
    private _deviceRemovedListener : (device : Tp.BaseDevice) => void;

    private _objects : Map<string, T>;

    constructor(view : DeviceView, mapper : (device : Tp.BaseDevice) => T) {
        this._view = view;
        this._mapper = mapper;

        this._deviceAddedListener = (o) => this._onDeviceAdded(o);
        this._deviceRemovedListener = (o) => this._onDeviceRemoved(o);

        this._objects = new Map();
    }

    values() : Iterable<T> {
        return this._objects.values();
    }

    getById(uniqueId : string) : T|undefined {
        return this._objects.get(uniqueId);
    }

    private _onDeviceAdded(o : Tp.BaseDevice) {
        this._objects.set(o.uniqueId!, this._mapper(o));
    }

    private _onDeviceRemoved(o : Tp.BaseDevice) {
        this._objects.delete(o.uniqueId!);
    }

    start() {
        this._view.on('object-added', this._deviceAddedListener);
        this._view.on('object-removed', this._deviceRemovedListener);
        this._view.start();
    }

    stop() {
        this._view.removeListener('object-added', this._deviceAddedListener);
        this._view.removeListener('object-removed', this._deviceRemovedListener);
        this._view.stop();
    }
}
