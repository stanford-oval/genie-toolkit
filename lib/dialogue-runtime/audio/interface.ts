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


/**
 * The interface implemented by skills that can retrieve audio to play,
 * and control APIs to play such audio.
 */
export interface AudioDevice {
    /**
     * Stop all playback.
     */
    stop(conversationId : string) : void;

    /**
     * Pause all playback.
     */
    pause?(conversationId : string) : void;

    /**
     * Resume playback.
     */
    resume?(conversationId : string) : void;
}

/**
 * Specifies what backend the client needs to use to actually play.
 */
export type CustomPlayerSpec = {
    type : 'spotify',
    username ?: string,
    accessToken ?: string,
} | {
    type : 'url'
} | {
    type : 'custom',
    /**
     * Map a pair of OS (as returned by process.platform) and
     * CPU architecture (as returned by process.arch), separated by -,
     * to a URL to download the binary to play.
     *
     * Example:
     * ```
     * {
     *  "linux-x64": "http://example.com/downloads/linux-x86-64/my-player",
     *  "win-x64": "http://example.com/downloads/linux-x86-64/my-player.exe"
     * }
     */
    binary : Record<string, string>;
    /**
     * Arguments to call the player binary with.
     *
     * The arguments will be appended to the binary name.
     *
     * If present, the special argument `...` will be replaced with the list of URLs
     * to play. In that case, all URLs will be passed to the binary at once.
     *
     * Otherwise, if the special argument `{}` is present, it will be replaced with
     * one URL to play. In that case, if multiple URLs are present, it is expected
     * that the binary will terminate successfully after playing each one.
     */
    args : string[];
};

/**
 * The interface implemented by components that can actually play audio.
 *
 * There are two implementations of this:
 * - one in process using the media-player platform capability
 * - one remote, marshalling over the conversation websocket
 */
export interface AudioPlayer {
    /**
     * Unique identifier of the conversation associated with this audio player.
     */
    conversationId : string;

    /**
     * Check if playing with given custom player backend is possible.
     *
     * This function will check whether the backend is supported, and will
     * attempt to initialize it.
     *
     * The function is safe to call if the backend is unsupported.
     *
     * @param spec the player backend to prepare
     * @returns whether preparation was successful or not
     */
    checkCustomPlayer(spec : CustomPlayerSpec) : Promise<boolean>;

    /**
     * Request playing audio.
     *
     * The function will wait until the player is ready (all speech queues
     * are flushed, all concurrent audio is paused) before returning.
     */
    prepare(spec ?: CustomPlayerSpec) : Promise<void>;

    /**
     * Stop playing.
     *
     * This method should stop all playback and flush all queues.
     *
     * Depending on the kind of backend currently playing, this might have
     * no effect, as backends might rely on the skill to invoke third-party APIs
     * to stop.
     */
    stop() : Promise<void>;

    /**
     * Pause playing.
     *
     * This method should pause all playback, while preserving the state
     * of all queues so playback can be resumed.
     *
     * Depending on the kind of backend currently playing, this might have
     * no effect, as backends might rely on the skill to invoke third-party APIs
     * to stop.
     */
    pause() : Promise<void>;

    /**
     * Resume playing.
     *
     * This method should attempt to resume playback. It should return an
     * error if resuming is not possible for any reason.
     *
     * Depending on the kind of backend currently playing, this might have
     * no effect, as backends might rely on the skill to invoke third-party APIs
     * to stop.
     */
    resume() : Promise<void>;

    /**
     * Start playing with the given URLs.
     *
     * Existing playback will be stopped and replaced with the given URLs.
     *
     * The method will return when playback is stopped or completes for
     * the given URLs.
     *
     * @param urls - the urls to play
     */
    playURLs(urls : string[]) : Promise<void>;

    /**
     * Set the output volume to a specific value.
     *
     * @param volume the volume, between 0 and 100
     */
    setVolume(volume : number) : Promise<void>;

    /**
     * Adjust the output volume by the given delta.
     *
     * @param delta the volume delta, between -100 and 100
     */
    adjustVolume(delta : number) : Promise<void>;

    /**
     * Mute or unmute the audio.
     */
    setMute(mute : boolean) : Promise<void>;

    /**
     * Enable or disable voice input.
     *
     * This command only affects wake-word activation. If the assistant can
     * be activated by other means (e.g. a button) it is not affected by enabling
     * the wake word.
     */
    setVoiceInput(input : boolean) : Promise<void>;

    /**
     * Enable or disable voice output.
     *
     * This command only affects speech from the agent. It does not affect
     * alert sounds or background audio.
     */
    setVoiceOutput(output : boolean) : Promise<void>;
}
