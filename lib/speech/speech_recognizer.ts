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

import * as Tp from 'thingpedia';
import * as events from 'events';
import * as Stream from 'stream';
import WebSocket from 'ws';

const URL = 'https://almond-nl.stanford.edu';

// 20 chunks * 320 bytes (160 S16LE samples) * 16kHz = 0.20 seconds
const DEFAULT_VAD_THRESHOLD = 20;

class SpeechRequest extends Stream.Writable {
    private _stream : Stream.Readable;
    private _endDetected : boolean;
    private _ended : boolean;
    private _started : boolean;
    private _vad : Tp.Capabilities.VadApi|null;
    private consecutiveSilence : number;
    private silenceThreshold : number;
    private _bufferedMessages : Buffer[];
    private _piped : boolean;
    private _endTimeout : NodeJS.Timeout|null = null;
    private _connection : WebSocket|null = null;
    private _listener : (msg : Buffer) => void;

    constructor(stream : Stream.Readable, initialBuffer : Buffer, vad : Tp.Capabilities.VadApi|null) {
        super();

        this._stream = stream;

        this._endDetected = false;
        this._ended = false;
        this._started = false;
        this._listener = this._handleMessage.bind(this);

        //this._debugFile = fs.createWriteStream('out_' + process.pid + '_' + (i++) + '.wav');
        this._vad = vad;
        this.silenceThreshold = process.env.VAD_THRESHOLD ? parseInt(process.env.VAD_THRESHOLD) : DEFAULT_VAD_THRESHOLD;
        this.consecutiveSilence = 0;

        // all chunks received before the connection is ready are buffered here
        this._bufferedMessages = [];

        this.write(initialBuffer);
        this._stream.pipe(this);
        this._piped = true;

        this.on('error', () => {
            if (!this._piped)
                return;
            this._piped = false;
            this._stream.unpipe(this);
        });
    }

    start(connection : WebSocket) {
        this._started = true;
        this._connection = connection;

        this._connection.on('message', this._listener);

        this._endTimeout = setTimeout(() => this.end(), 150000);
        for (const message of this._bufferedMessages)
            this._connection.send(message, { binary: true });
        this._bufferedMessages = [];
    }

    _finish(callback : () => void) {
        // readable stream ended
        this._piped = false;
        this.end();
        callback();
    }

    end() {
        if (this._piped) {
            this._piped = false;
            this._stream.unpipe(this);
        }

        if (this._ended)
            return;

        // end() before start() indicates an error connecting to the server (e.g.
        // access token error)
        if (!this._started) {
            this._ended = true;
            return;
        }

        if (this._endTimeout) clearTimeout(this._endTimeout);

        this._ended = true;
        //this._debugFile.end();
    }

    _handleMessage(msg : Buffer) {
        //console.log('Received message');
        //console.log(msg);
        let json;
        try {
            json = JSON.parse(msg.toString());
        } catch(e) {
            this.emit('error', e);
            this.end();
            return;
        }

        if (json.status === 400 && json.code === "E_NO_MATCH")
            this.emit('done', "NoMatch");
        else if (json.result === 'ok')
            this.emit('done', "Success", json.text);
        else
            this.emit('error', msg);
        this.end();
    }

    _write(chunk : Buffer, encoding : BufferEncoding, callback : (err ?: Error) => void) {
        if (this._ended || this._endDetected) {
            callback();
            return;
        }
        //console.log('Sending chunk of length ' + chunk.length);
        if (this._connection && this._connection.readyState === 1) {
            // OPEN
            if (this._vad) {
                if (this._vad.process(chunk))
                    this.consecutiveSilence = 0;
                else
                    this.consecutiveSilence++;
            }
            if (this.consecutiveSilence === this.silenceThreshold) {
                this._endDetected = true;
                console.log("VAD threshold reached", this.consecutiveSilence);
                this._connection.send(undefined, {}, (err ?: Error) => callback(err));
            } else {
                this._connection.send(chunk, { binary: true }, (err ?: Error) => callback(err));
            }
        } else {
            this._bufferedMessages.push(chunk);
            callback();
        }
    }
}

export interface SpeechRecognizerOptions {
    locale ?: string;
    nlUrl ?: string;
    vad ?: Tp.Capabilities.VadApi|null;
}

export default class SpeechRecognizer extends events.EventEmitter {
    private _language : string;
    private _baseUrl : string;
    private _connection : WebSocket|null;
    private _vad : Tp.Capabilities.VadApi|null;

    constructor(options : SpeechRecognizerOptions = {}) {
        super();
        this._language = options.locale || 'en-US';
        this._baseUrl = options.nlUrl || URL;
        this._connection = null;
        this._vad = options.vad || null;
    }

    close() {
        if (!this._connection)
            return;
        this._connection.close();
        this._connection = null;
    }

    _doConnect() {
        const url = this._baseUrl + '/' + this._language + '/voice/stream';
        const connection = new WebSocket(url, {
            perMessageDeflate: true
        });
        return new Promise((callback, errback) => {
            connection.on('unexpected-response', (req, res) => {
                errback(new Error(res.statusMessage));
            });
            connection.on('open', () => {
                this._connection = connection;
                console.log('STT connection opened');
                this._connection.send(JSON.stringify({ ver: 1 }));
                callback(connection);
            });
            connection.on('close', (code, reason) => {
                if (code !== 1000) // 1000 = normal closure (eg timeout, or we closed on our side)
                    console.log('Connection to STT service closed: ' + code + ' ' + reason);
                this._connection = null;
            });
            connection.on('error', (e : Error) => {
                this._connection = null;
                this.emit('error', e);
            });
        });
    }

    _ensureConnection() {
        if (this._connection)
            this._connection.close();
        return this._doConnect();
    }

    request(stream : Stream.Readable, initialBuffer : Buffer) {
        const req = new SpeechRequest(stream, initialBuffer, this._vad);
        this._ensureConnection().then((connection : any) => {
            req.start(connection);
        }).catch((e) => {
            req.end();
            this.emit('error', e);
        });
        req.on('error', (e) => this.emit('error', e));
        return req;
    }
}
