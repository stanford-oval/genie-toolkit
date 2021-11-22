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

import CustomError from '../../utils/custom_error';
import type DeviceDatabase from '../../engine/devices/database';

import { AudioDevice, AudioPlayer, CustomPlayerSpec } from './interface';

/**
 * State tracked with each player, associating a player with the skill
 * currently playing on it.
 */
interface ConversationAudioState {
    conversationId : string;
    player : AudioPlayer|null;
    device : Tp.BaseDevice|null;
    iface : AudioDevice|null;

    /**
     * Timestamp of the last interaction (in milliseconds from the Unix epoch).
     *
     * This is used to choose a player to play on when none is specified
     * by a skill expliclity.
     */
    timestamp : number;
}

/**
 * Coordinate access to audio between multiple skills.
 *
 * This class coordinates between N players (speakers) and M skills
 * that can play media (news, music/spotify, radio, etc.).
 *
 * Each player is associated with a conversation (through the unique
 * conversation ID). It is expected that commands coming from a conversation
 * will control the player associated with that conversation.
 *
 * There are two modes of usage.
 *
 * If the skill can control its own playback through some internal
 * API (as is the case with Spotify), the skill will call {@link prepare}
 * and then {@link requestAudio} when it first handles a command to play.
 * After {@link requestAudio} succeeds, the skill call the internal API
 * to actually start the playback. Subsequent control occurs over the internal
 * API.
 *
 * If the skill cannot control playback directly (it only retrieves URLs),
 * it will call {@link playURLs} instead. Subsequent control is handled
 * by the audio controller directly.
 */
export default class AudioController extends events.EventEmitter {
    private _devices : DeviceDatabase;
    private _deviceRemovedListener : (d : Tp.BaseDevice) => void;
    private _players : Map<string, ConversationAudioState>;

    constructor(devices : DeviceDatabase) {
        super();

        this._players = new Map;
        this._devices = devices;
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
    }

    async addPlayer(player : AudioPlayer) {
        console.log(`Adding new audio player on ${player.conversationId}`);
        const existing = this._players.get(player.conversationId);
        if (existing) {
            existing.player = player;
            existing.timestamp = Date.now();
        } else {
            this._players.set(player.conversationId, {
                conversationId: player.conversationId,
                player,
                device: null,
                iface: null,
                timestamp: Date.now()
            });
        }
    }
    async removePlayer(player : AudioPlayer) {
        const state = this._players.get(player.conversationId);
        if (!state || state.player !== player)
            return;
        console.log(`Removing audio player from ${player.conversationId}`);
        // set the player interface to null but keep the state
        // so the next time the client reconnects we'll be able to stop/resume
        state.player = null;
    }

    async start() {
        this._devices.on('device-removed', this._deviceRemovedListener);
    }
    async stop() {
        this._devices.removeListener('device-removed', this._deviceRemovedListener);
    }

    private _getPlayer(conversationId : string|undefined) : ConversationAudioState|undefined {
        if (conversationId !== undefined)
            return this._players.get(conversationId);

        let best : ConversationAudioState|undefined, bestTimestamp = undefined;
        for (const state of this._players.values()) {
            if (bestTimestamp === undefined || state.timestamp >= bestTimestamp) {
                best = state;
                bestTimestamp = state.timestamp;
            }
        }
        return best;
    }

    /**
     * Retrieve the player associated with the given conversation, if any.
     *
     * This method should not be called outside of Genie.
     *
     * @param conversationId
     */
    getPlayer(conversationId ?: string) : AudioPlayer|undefined {
        const state = this._getPlayer(conversationId);
        return state?.player || undefined;
    }

    /**
     * Resume playing audio.
     *
     * The method will instruct the currently playing skill to resume playing.
     *
     * @param conversationId the conversation on which to resume playing; if unspecified,
     *   any conversation that can be resumed will be resumed
     */
    async resumeAudio(conversationId ?: string) {
        const state = this._getPlayer(conversationId);
        if (!state)
            throw new CustomError(`no_device_playing`, `No interface registered to resume audio`);

        state.timestamp = Date.now();
        if (state.iface && state.iface.resume)
            await state.iface.resume(state.conversationId);
        else
            await state.player?.resume();
    }

    private _normalizeCompatIface(iface : AudioDevice|(() => Promise<void>)) {
        if (typeof iface === 'function')
            return { stop: iface };
        else
            return iface;
    }

    /**
     * Check if the custom player backend is available.
     *
     * This function will check whether the backend is supported, and will
     * attempt to initialize it using the given spec.
     *
     * The function is safe to call if the backend is unsupported, and will
     * return false.
     *
     * @param spec the player to check
     * @param conversationId the conversation ID associated with the current command;
     *      if specified, it will affect the choice of which player to play on
     * @returns
     */
    async checkCustomPlayer(spec : CustomPlayerSpec, conversationId ?: string) : Promise<boolean> {
        const state = this._getPlayer(conversationId);
        if (!state || !state.player)
            return false;
        return state.player.checkCustomPlayer(spec);
    }

    /**
     * Request audio on behalf of the given device (skill).
     *
     * This method must be called before starting a background playback operation,
     * using a media-player capability or using a device-specific service.
     *
     * The provided interface will be used to pause/resume audio when a different device
     * request audio at a later time, or when the user requests to "stop" or "resume"
     * without specifying what device to use.
     *
     * This method can be called multiple times for the same device, with no effect.
     *
     * @param device the device that requests to play audio
     * @param iface the interface to control playback while the device is current
     * @param conversationId the conversation ID associated with the current command;
     *      if specified, it will affect the choice of which player to play on
     * @param spec parameters affecting which player to choose
     */
    async requestAudio(device : Tp.BaseDevice,
                       iface : AudioDevice|(() => Promise<void>),
                       conversationId ?: string,
                       spec ?: CustomPlayerSpec) {
        const state = this._getPlayer(conversationId);
        if (!state || !state.player)
            throw new CustomError(`unsupported`, `No player is available to complete this request`);

        if (device === state.device) {
            state.iface = this._normalizeCompatIface(iface);
            state.timestamp = Date.now();
            await state.player.prepare(spec);
            return;
        }
        state.timestamp = Date.now();
        if (state.iface)
            await state.iface.stop(state.player.conversationId);
        state.device = device;
        console.log(`Switching audio to ${state.device.uniqueId}`);
        await state.player.prepare(spec);
        state.iface = this._normalizeCompatIface(iface);
    }

    /**
     * Request to play the given audio URLs
     * @param device the skill on behalf of which playback occurs
     * @param urls the urls to play
     * @param conversationId the conversation ID associated with the current command;
     *      if specified, it will affect the choice of which player to play on
     */
    async playURLs(device : Tp.BaseDevice,
                   urls : string[],
                   conversationId ?: string) {
        const state = this._getPlayer(conversationId);
        if (!state || !state.player)
            throw new CustomError(`unsupported`, `No player is available to complete this request`);

        state.timestamp = Date.now();
        if (state.iface)
            await state.iface.stop(state.conversationId);
        state.device = device;
        state.iface = null;
        console.log(`Switching audio to ${state.device.uniqueId}`);
        await state.player.playURLs(urls);
    }

    /**
     * Request audio on behalf of the system itself.
     *
     * This method must not be called outside of Genie
     */
    async requestSystemAudio(iface : AudioDevice, conversationId ?: string) {
        const state = this._getPlayer(conversationId);
        if (!state || !state.player)
            throw new CustomError(`unsupported`, `No player is available to complete this request`);

        state.timestamp = Date.now();
        if (state.iface)
            await state.iface.stop(state.conversationId);
        state.device = null;
        console.log(`Switching audio to system`);
        state.iface = this._normalizeCompatIface(iface);

        return state.player;
    }

    /**
     * Release the control of background audio on behalf of the given device.
     *
     * This method has no effect if the given device is not currently controlling
     * audio.
     */
    releaseAudio(device : Tp.BaseDevice, conversationId ?: string) {
        if (conversationId !== undefined) {
            const state = this._getPlayer(conversationId);

            if (!state || device !== state.device)
                return;

            state.device = null;
            state.iface = null;
        } else {
            for (const state of this._players.values()) {
                if (state.device === device) {
                    state.device = null;
                    state.iface = null;
                }
            }
        }
    }

    /**
     * Pause all audio coming from this assistant.
     *
     * This method will inform the currently playing device that it must pause
     * playing. It corresponds to the command "pause".
     *
     * This command differs from {@link stopAudio} because the audio device
     * should interpret this request in a way that makes the audio resumable.
     *
     * @param the conversation ID associated with the command; if specified,
     *   only audio associated with that conversation will be paused
     */
    async pauseAudio(conversationId ?: string) {
        this.emit('stop', conversationId);

        if (conversationId !== undefined) {
            const state = this._getPlayer(conversationId);
            if (!state)
                return;

            await state.player?.pause();
            if (state.iface !== null) {
                if (state.iface.pause)
                    await state.iface.pause(state.conversationId);
                else
                    await state.iface.stop(state.conversationId);
            }

            // the interface continues to be the current audio interface
            // so it will be resumed on a resume command later
        } else {
            for (const state of this._players.values()) {
                await state.player?.pause();
                if (state.iface !== null) {
                    if (state.iface.pause)
                        await state.iface.pause(state.conversationId);
                    else
                        await state.iface.stop(state.conversationId);
                }
            }
        }
    }

    /**
     * Stop all audio coming from this assistant.
     *
     * This method will inform the currently playing device that it must stop
     * playing. It corresponds to the command "stop".
     *
     * @param the conversation ID associated with the command; if specified,
     *   only audio associated with that conversation will be stopped
     */
    async stopAudio(conversationId ?: string) {
        this.emit('stop', conversationId);

        if (conversationId !== undefined) {
            const state = this._getPlayer(conversationId);
            if (!state)
                return;

            await state.player?.stop();
            await state.iface?.stop(state.conversationId);
            state.device = null;
            state.iface = null;
        } else {
            for (const state of this._players.values()) {
                await state.player?.stop();
                if (state.iface !== null)
                    await state.iface.stop(state.conversationId);
                state.device = null;
                state.iface = null;
            }
        }
    }

    private _onDeviceRemoved(device : Tp.BaseDevice) {
        console.log(`Audio device removed`);
        this.releaseAudio(device);
    }
}
