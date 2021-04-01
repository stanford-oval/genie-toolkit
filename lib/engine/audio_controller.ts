// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as events from 'events';
import * as Tp from 'thingpedia';

import type DeviceDatabase from './devices/database';

/**
 * Coordinate access to audio between multiple skills.
 */
export default class AudioController extends events.EventEmitter {
    private _devices : DeviceDatabase;
    private _deviceRemovedListener : (d : Tp.BaseDevice) => void;

    private _currentDevice : Tp.BaseDevice|null = null;
    private _releaseCallback : (() => void|Promise<void>)|null = null;

    constructor(devices : DeviceDatabase) {
        super();

        this._devices = devices;
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
    }

    async start() {
        this._devices.on('device-removed', this._deviceRemovedListener);
    }
    async stop() {
        this._devices.removeListener('device-removed', this._deviceRemovedListener);
        await this.stopAudio();
    }

    /**
     * Request background audio on behalf of the given device.
     *
     * This method must be called before starting a background playback operation,
     * using a media-player capability or using a device-specific service.
     *
     * The provided release callback will be called when a different device
     * request audio at a later time. When called, the release callback must stop
     * playback on behalf of the current device.
     *
     * This method can be called multiple times for the same device, with no effect.
     */
    async requestAudio(device : Tp.BaseDevice, releaseCallback : () => void|Promise<void>) {
        if (device === this._currentDevice) {
            this._releaseCallback = releaseCallback;
            return;
        }

        if (this._releaseCallback)
            this._releaseCallback();
        this._currentDevice = device;
        console.log(`Switching audio to ${this._currentDevice.uniqueId}`);
        this._releaseCallback = releaseCallback;
    }

    /**
     * Request background audio on behalf of the system itself.
     *
     * This method must not be called outside of Genie
     */
    async requestSystemAudio(releaseCallback : () => void|Promise<void>) {
        if (this._releaseCallback)
            this._releaseCallback();
        this._currentDevice = null;
        console.log(`Switching audio to system`);
        this._releaseCallback = releaseCallback;
    }

    /**
     * Release the control of background audio on behalf of the given device.
     *
     * This method has no effect if the given device is not currently controlling
     * audio.
     */
    async releaseAudio(device : Tp.BaseDevice) {
        if (device !== this._currentDevice)
            return;
        this._currentDevice = null;
        this._releaseCallback = null;
    }

    /**
     * Stop all audio coming from this assistant.
     *
     * This method will inform the currently playing device that it must stop
     * playing. It corresponds to the command "stop".
     */
    async stopAudio() {
        this.emit('stop');
        if (this._releaseCallback)
            await this._releaseCallback();
        this._releaseCallback = null;
    }

    private _onDeviceRemoved(device : Tp.BaseDevice) {
        if (device === this._currentDevice) {
            console.log(`Audio device removed`);
            this._currentDevice = null;
            this._releaseCallback = null;
        }
    }
}
