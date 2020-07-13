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

const events = require('events');
const Stream = require('stream');
const https = require('https');
const Url = require('url');

const uuid = require('uuid');
const WebSocket = require('ws');

function encodeHeaders(path, contentType, requestId) {
    let headers = {
        'path': path,
        'x-timestamp': (new Date).toISOString(),
        'content-type': contentType
    };
    if (requestId)
        headers['x-requestid'] = requestId;
    let str = '';
    for (let name in headers)
        str += name + ': ' + headers[name] + '\r\n';
    return str;
}

class SpeechRequest extends Stream.Writable {
    constructor(stream) {
        // this is important, as the protocol does not allow chunks larger than 8192 bytes
        super({ highWaterMark: 8192 });

        this._stream = stream;

        this._requestId = uuid.v4().replace(/-/g, '');
        this._endDetected = false;
        this._ended = false;
        this._started = false;
        this._sentRIFFHeader = false;

        //this._debugFile = fs.createWriteStream('out_' + process.pid + '_' + (i++) + '.wav');

        this._startTime = (new Date).toISOString();
        this._stream.pipe(this);
        this._piped = true;

        // all chunks received before the connection is ready are buffered here
        this._bufferedMessages = [];

        this.on('error', () => {
            if (!this._piped)
                return;
            this._piped = false;
            this._stream.unpipe(this);
        });
    }

    start(connection, connectionTelemetry) {
        this._started = true;
        this._connection = connection;
        this._endTimeout = setTimeout(() => this.end(), 150000);

        this._listener = this._handleMessage.bind(this);
        this._connection.on('message', this._listener);

        this._receivedMessages = {};
        this._connectionTelemetry = connectionTelemetry;

        for (let message of this._bufferedMessages)
            this._connection.send(message, { binary: true });
        this._bufferedMessages = [];
    }

    _finish(callback) {
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

        clearTimeout(this._endTimeout);
        this._endTime = (new Date).toISOString();

        let receivedMessages = [];
        for (let path in this._receivedMessages) {
            if (this._receivedMessages[path].length === 1)
                receivedMessages.push({ [path]: this._receivedMessages[path][0] });
            else
                receivedMessages.push({ [path]: this._receivedMessages[path] });
        }
        this._sendTextMessage('telemetry', 'application/json', JSON.stringify({
            ReceivedMessages: receivedMessages,
            Metrics: [
                this._connectionTelemetry,
                {
                    Name: 'Microphone',
                    Start: this._startTime,
                    End: this._endTime
                }
            ]
        }));
        this._ended = true;

        //this._debugFile.end();
    }

    _handleMessage(msg) {
        //console.log('Received message');
        //console.log(msg);
        let lines = msg.toString('utf8').split('\r\n');
        let headers = {};
        let body;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.length === 0) {
                body = lines.slice(i+1).join('\r\n');
                break;
            }
            let tokens = line.split(':', 2);
            headers[tokens[0].trim().toLowerCase()] = tokens[1].trim();
        }

        if (this._requestId !== headers['x-requestid'])
            return;

        let json = JSON.parse(body);
        let path = headers['path'];
        if (!this._receivedMessages[path])
            this._receivedMessages[path] = [];
        this._receivedMessages[path].push((new Date).toISOString());

        if (path === 'speech.hypothesis')
            this.emit('hypothesis', json.Text);
        else if (path === 'speech.phrase')
            this.emit('done', json.RecognitionStatus, json.DisplayText);
        else if (path === 'speech.endDetected')
            this._endDetected = true;
        else if (path === 'turn.end')
            this.end();
    }

    _write(chunk, encoding, callback) {
        if (this._ended || this._endDetected) {
            callback();
            return;
        }
        //console.log('Sending chunk of length ' + chunk.length);

        let header = Buffer.from(encodeHeaders('audio', 'audio/x-wav', this._requestId), 'utf8');
        let message;
        if (!this._sentRIFFHeader)
            message = Buffer.alloc(2 + header.length + 44 + chunk.length);
        else
            message = Buffer.alloc(2 + header.length + chunk.length);
        message.writeInt16BE(header.length, 0);
        header.copy(message, 2);
        if (!this._sentRIFFHeader) {
            let riffHeader = Buffer.alloc(44);
            // the size of the chunks are chosen based on what GStreamer produces by default
            riffHeader.write('RIFF', 0);
            riffHeader.writeInt32LE(0x7fff0024, 4);
            riffHeader.write('WAVE', 8);
            riffHeader.write('fmt ', 12);
            riffHeader.writeInt32LE(16, 16); // fmt pkt size
            riffHeader.writeInt16LE(1, 20); // format (1 = PCM)
            riffHeader.writeInt16LE(1, 22); // number of channels
            riffHeader.writeInt32LE(16000, 24); // sample rate
            riffHeader.writeInt32LE((16000 * 16 * 1)/8, 28); // byterate
            riffHeader.writeInt16LE((16 * 1)/8, 32); // byte per sample
            riffHeader.writeInt16LE(16, 34); // bits per sample
            riffHeader.write('data', 36);
            riffHeader.writeInt32LE(0x7fff0000, 40);
            //this._debugFile.write(riffHeader);
            riffHeader.copy(message, 2 + header.length);
            //this._debugFile.write(chunk);
            chunk.copy(message, 2 + 44 + header.length);
            this._sentRIFFHeader = true;
        } else {
            //this._debugFile.write(chunk);
            chunk.copy(message, 2 + header.length);
        }

        if (this._connection && this._connection.readyState === 1) {
            // OPEN
            this._connection.send(message, { binary: true }, (err) => callback(err));
        } else {
            this._bufferedMessages.push(message);
            callback();
        }
    }

    _sendTextMessage(path, contentType, body) {
        let header = encodeHeaders(path, contentType, this._requestId);
        let msg = header + '\r\n' + body;
        //console.log(msg);
        if (this._connection.readyState === 1) // OPEN
            this._connection.send(msg, { binary: false });
    }
}

module.exports = class SpeechRecognizer extends events.EventEmitter {
    constructor(options = {}) {
        super();
        this._language = options.locale || 'en-US';
        this._subscriptionKey = options.subscriptionKey;
        this._connection = null;
    }

    close() {
        if (!this._connection)
            return;
        this._connection.close();
        this._connection = null;
    }

    _obtainAccessToken() {
        let url = Url.parse('https://api.cognitive.microsoft.com/sts/v1.0/issueToken');
        url.method = 'POST';
        url.headers = {
            'Content-type': 'application/x-www-form-urlencoded',
            'Ocp-Apim-Subscription-Key': this._subscriptionKey,
            'Content-Length': '0'
        };
        return new Promise((callback, errback) => {
            var req = https.request(url, (res) => {
                if (res.statusCode !== 200) {
                    errback(new Error(res.statusMessage));
                    return;
                }
                let buf ='';
                res.on('data', (d) => buf += d);
                res.on('error', errback);
                res.on('end', () => callback(buf));
            });
            req.on('error', errback);
            req.end();
        });
    }

    _ensureAccessToken() {
        let now = (new Date).getTime();
        if (this._accessToken && this._accessTokenExpires >= now)
            return Promise.resolve(this._accessToken);
        return this._obtainAccessToken().then((token) => {
            console.log('Obtained access token ' + token);
            this._accessToken = token;
            // access tokens last for 10 minutes
            // make them 9 minutes to be safe
            this._accessTokenExpires = (new Date).getTime() + 9 * 3600 * 1000;
            return token;
        });
    }

    _doConnect(accessToken) {
        let startTime = (new Date).toISOString();
        let connectionId = uuid.v4().replace(/-/g, '');

        let url = 'wss://speech.platform.bing.com/speech/recognition/interactive/cognitiveservices/v1?language=' + this._language;
        this._connectionTelemetry = {
            Name: 'Connection',
            Id: connectionId,
            Start: startTime
        };
        let connection = new WebSocket(url, {
            perMessageDeflate: true,
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Ocp-Apim-Subscription-Key': this._subscriptionKey,
                'X-ConnectionId': connectionId
            }
        });
        return new Promise((callback, errback) => {
            connection.on('unexpected-response', (req, res) => {
                errback(new Error(res.statusMessage));
            });
            connection.on('open', () => {
                //console.log('Connection opened');
                this._connectionTelemetry.End = (new Date).toISOString();

                // connection telemetry confuses the server, and apparently
                // we don't need it
                /*let msg = encodeHeaders('speech.config', 'application/json; charset=utf-8') + '\r\n'
                + JSON.stringify({
                    context: {
                        system: {
                            version: '1.0.0',
                        },
                        os: {
                            platform: 'Linux',
                            name: 'Debian',
                            version: '9.0.0',
                        },
                        device: {
                            manufacturer: 'Unknown',
                            model: 'Unknown',
                            version: '1.0.0'
                        }
                    }
                });
                console.log(msg);
                this._connection.send(msg);*/

                this._connection = connection;
                callback(connection);
            });
            connection.on('close', (code, reason) => {
                if (code !== 1000) // 1000 = normal closure (eg timeout, or we closed on our side)
                    console.log('Connection to MS Speech Recognizer service closed: ' + code + ' ' + reason);
                this._connection = null;
            });
            connection.on('error', (e) => {
                this._connection = null;
                if (e.code === 'ECONNRESET')
                    console.log('Error on MS Speech Recognizer: Connection Reset');
                else
                    this.emit('error', e);
            });
        });
    }

    _ensureConnection() {
        if (this._connection)
            return Promise.resolve(this._connection);
        else
            return this._ensureAccessToken().then((token) => this._doConnect(token));
    }

    request(stream) {
        let req = new SpeechRequest(stream);
        this._ensureConnection().then((connection) => {
            req.start(connection, this._connectionTelemetry);
        }).catch((e) => {
            req.end();
            this.emit('error', e);
        });
        req.on('error', (e) => this.emit('error', e));
        return req;
    }
};
