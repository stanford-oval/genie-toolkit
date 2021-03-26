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
import assert from 'assert';
import * as events from 'events';
import * as stream from 'stream';

class CancelledError extends Error {
    code : string;

    constructor() {
        super("Cancelled");
        this.code = 'ECANCELLED';
    }
}

const URL = 'https://almond-nl.stanford.edu';

enum QueueItemType { END_FRAME, SPEECH, SOUND_EFFECT, ERROR }
type QueueItem = {
    type : QueueItemType.END_FRAME;
    resolve() : void;
    reject(err : Error) : void;
} | {
    type : QueueItemType.SPEECH;
    buffer : Buffer;
    sampleRate : number;
    numChannels : number;
    text : string;
} | {
    type : QueueItemType.SOUND_EFFECT;
    effect : string;
} | {
    type : QueueItemType.ERROR;
    error : Error;
}

interface SoundOutputStream extends stream.Writable {
    discard() : void;
}

export default class SpeechSynthesizer extends events.EventEmitter {
    private _baseUrl : string;
    private _locale : string;
    private _platform : Tp.BasePlatform;
    private _soundCtx : Tp.Capabilities.SoundApi;
    private _queue : Array<QueueItem|Promise<QueueItem>>;
    private _speaking : boolean;
    private _outputStream : SoundOutputStream|null;
    private _closeTimeout : NodeJS.Timeout|null;
    private _sampleRate : number;
    private _numChannels : number;

    constructor(platform : Tp.BasePlatform, url = URL) {
        super();
        this._baseUrl = url;
        this._locale = platform.locale;
        this._platform = platform;
        this._soundCtx = platform.getCapability('sound')!;

        this._queue = [];
        this._speaking = false;

        this._outputStream = null;
        this._closeTimeout = null;
        this._sampleRate = 0;
        this._numChannels = 0;
    }

    get speaking() {
        return this._speaking;
    }

    async clearQueue() {
        if (this._outputStream)
            this._outputStream.discard();

        const err = new CancelledError();
        for await (const q of this._queue) {
            if (q.type === QueueItemType.END_FRAME)
                q.reject(err);
        }
        this._queue.length = 0;
    }

    private async _synth(text : string) : Promise<QueueItem> {
        try {
            const [buffer,] = await Tp.Helpers.Http.post(this._baseUrl + '/' + this._locale + '/voice/tts', JSON.stringify({
                text
            }), {
                dataContentType: 'application/json',
                raw: true
            });

            const numChannels = buffer.readInt16LE(22);
            const sampleRate = buffer.readInt32LE(24);
            // check bytes per sample (we only support S16LE format, which is what everybody uses anyway)
            assert.strictEqual(buffer.readInt16LE(32), 2);

            console.log(this._numChannels, this._sampleRate);

            // remove the wav header (44 bytes)
            const sliced = buffer.slice(44, buffer.length);
            console.log(buffer.length, sliced.length);

            return { type: QueueItemType.SPEECH, buffer: sliced, sampleRate, numChannels, text };
        } catch(e) {
            return { type: QueueItemType.ERROR, error: e };
        }
    }

    say(text : string) {
        this._queue.push(this._synth(text));
        if (!this._speaking)
            this._sayNext();
    }
    soundEffect(effect : string) {
        this._queue.push({ type: QueueItemType.SOUND_EFFECT, effect });
        if (!this._speaking)
            this._sayNext();
    }
    endFrame() : Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const callbacks = {
                type: QueueItemType.END_FRAME as const,
                resolve, reject
            };

            this._queue.push(callbacks);
            if (!this._speaking)
                this._sayNext();
        });
    }

    private _silence() {
        // force flush the buffer with 0.15 second of silence
        // this also causes a pause between the utterances, which sounds natural
        // and slows down the pace
        const bufferLength = 0.15 * this._sampleRate * this._numChannels * 2;
        this._outputStream!.write(Buffer.alloc(bufferLength));
        return 1000;
    }

    private _ensureOutputStream(result : { sampleRate : number, numChannels : number }) {
        if (this._closeTimeout)
            clearTimeout(this._closeTimeout);
        this._closeTimeout = setTimeout(() => {
            if (this._outputStream)
                this._outputStream.end();
            this._outputStream = null;
            this._closeTimeout = null;
        }, 60000);

        if (this._outputStream && this._sampleRate === result.sampleRate
            && this._numChannels === result.numChannels)
            return;
        if (this._outputStream)
            this._outputStream.end();
        this._sampleRate = result.sampleRate;
        this._numChannels = result.numChannels;
        this._outputStream = this._soundCtx.createPlaybackStream({
            format: 'S16LE', // signed 16 bit little endian
            rate: this._sampleRate,
            channels: this._numChannels,
            stream: 'genie-voice-output',
            latency: 100000, // us (= 0.1 s)
            properties: {
                'media.role': 'voice-assistant',
                'filter.want': 'echo-cancel',
            }
        }) as SoundOutputStream;
        this._outputStream.on('drain', () => {
            console.log('Done speaking');
            this.emit('done');
            this._speaking = false;
        });
    }

    private async _sayNext() {
        if (this._queue.length === 0)
            return;
        if (!this._speaking) {
            console.log('Starting to speak...');
            this.emit('speaking');
        }
        this._speaking = true;

        const qitem = await this._queue.shift()!;
        try {
            if (qitem.type === QueueItemType.END_FRAME) {
                qitem.resolve();
            } else if (qitem.type === QueueItemType.ERROR) {
                throw qitem.error;
            } else if (qitem.type === QueueItemType.SPEECH) {
                this._ensureOutputStream(qitem);

                let duration = qitem.buffer.length /2 /
                    qitem.sampleRate / qitem.numChannels * 1000;
                console.log('outputstream write for ' + qitem.text + ', delay of ' + duration);
                this._outputStream!.write(qitem.buffer);
                duration += this._silence();
            } else {
                const effectApi = this._platform.getCapability('sound-effects');
                if (effectApi)
                    await effectApi.play(qitem.effect);
            }
        } catch(e) {
            console.error('Failed to speak: ' + e);
        }

        process.nextTick(() => this._sayNext());
    }
}