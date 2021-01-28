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

import assert from 'assert';
import * as events from 'events';
import * as child_process from 'child_process';
import * as Tp from 'thingpedia';

import JsonDatagramSocket from '../utils/json_datagram_socket';

const DEFAULT_QUESTION = 'translate from english to thingtalk';

interface PredictionCandidate {
    answer : string;
    score : number;
}

interface Request {
    resolve(data : PredictionCandidate[][]) : void;
    reject(err : Error) : void;
}

const MINIBATCH_SIZE = 30;
const MAX_LATENCY = 50; // milliseconds
interface Example {
    context : string;
    question : string;
    answer ?: string;
    example_id ?: string;

    resolve(data : PredictionCandidate[]) : void;
    reject(err : Error) : void;
}

class LocalWorker extends events.EventEmitter {
    private _child : child_process.ChildProcess|null;
    private _stream : JsonDatagramSocket|null;
    private _nextId : 0;
    private _requests : Map<number, Request>;
    private _modeldir : string;

    constructor(modeldir : string) {
        super();

        this._child = null;
        this._stream = null;
        this._nextId = 0;
        this._requests = new Map;

        this._modeldir = modeldir;
    }

    stop() {
        if (this._child)
            this._child.kill();
        this._child = null;
    }

    start() {
        const args = [
            'server',
            '--stdin',
            '--path', this._modeldir,
        ];
        if (process.env.GENIENLP_EMBEDDINGS)
            args.push('--embeddings', process.env.GENIENLP_EMBEDDINGS);
        if (process.env.GENIENLP_DATABASE)
            args.push('--database', process.env.GENIENLP_DATABASE);

        this._child = child_process.spawn('genienlp', args, {
            stdio: ['pipe', 'pipe', 'inherit']
        });
        this._child.on('error', (e) => {
            this._failAll(e);
            this.emit('error', e);
        });
        this._child.on('exit', (code, signal) => {
            //console.error(`Child exited with code ${code}, signal ${signal}`);

            const err = new Error(`Worker died`);
            this._failAll(err);
            this.emit('error', err);
            this._child = null;
            this.emit('exit');
        });

        this._stream = new JsonDatagramSocket(this._child.stdout!, this._child.stdin!, 'utf8');
        this._stream.on('error', (e) => {
            this._failAll(e);
            this.emit('error', e);
        });
        this._stream.on('data', (msg) => {
            const req = this._requests.get(msg.id);
            if (!req) // ignore bogus request
                return;
            if (msg.error) {
                req.reject(new Error(msg.error));
            } else {
                req.resolve(msg.instances.map((instance : any) : PredictionCandidate[] => {
                    if (instance.candidates) {
                        return instance.candidates;
                    } else {
                        // no beam search, hence only one candidate, and fixed score
                        return [{
                            answer: instance.answer,
                            score: 1
                        }];
                    }
                }));
            }
            this._requests.delete(msg.id);
        });
    }

    private _failAll(error : Error) {
        for (const { reject } of this._requests.values())
            reject(error);
        this._requests.clear();
    }

    request(task : string, minibatch : Example[]) : Promise<PredictionCandidate[][]> {
        const id = this._nextId ++;

        return new Promise((resolve, reject) => {
            this._requests.set(id, { resolve, reject });
            //console.error(`${this._requests.size} pending requests`);

            this._stream!.write({ id, task, instances: minibatch }, (err : Error | undefined | null) => {
                if (err) {
                    console.error(err);
                    reject(err);
                }
            });
        });
    }
}

class RemoteWorker extends events.EventEmitter {
    private _url : string;

    constructor(url : string) {
        super();
        this._url = url;
    }

    start() {}
    stop() {}

    async request(task : string, minibatch : Example[]) : Promise<PredictionCandidate[][]> {
        const response = await Tp.Helpers.Http.post(this._url, JSON.stringify({
            id: 0, // should be ignored
            task,
            instances: minibatch
        }), { dataContentType: 'application/json', accept: 'application/json' });
        const parsed = JSON.parse(response);
        return JSON.parse(parsed.predictions).instances.map((instance : any) : PredictionCandidate[] => {
            if (instance.candidates) {
                return instance.candidates;
            } else {
                // no beam search, hence only one candidate, and fixed score
                return [{
                    answer: instance.answer,
                    score: 1
                }];
            }
        });
    }
}

export default class Predictor {
    private _modeldir : string;
    private _worker : LocalWorker|RemoteWorker|null;
    private _stopped : boolean;

    private _minibatchTask = '';
    private _minibatch : Example[] = [];
    private _minibatchStartTime = 0;

    constructor(modeldir : string) {
        this._modeldir = modeldir;
        this._worker = null;

        this._stopped = false;
    }

    private _flushRequest() {
        const minibatch = this._minibatch;
        const task = this._minibatchTask;
        this._minibatch = [];
        this._minibatchTask = '';
        this._minibatchStartTime = 0;

        //console.error(`minibatch: ${minibatch.length} instances`);

        this._worker!.request(task, minibatch).then((candidates) => {
            assert(candidates.length === minibatch.length);
            for (let i = 0; i < minibatch.length; i++)
                minibatch[i].resolve(candidates[i]);
        }, (err : Error) => {
            for (let i = 0; i < minibatch.length; i++)
                minibatch[i].reject(err);
        });
    }

    private _startRequest(ex : Example, task : string, now : number) {
        assert(this._minibatch.length === 0);
        this._minibatch.push(ex);
        this._minibatchTask = task;
        this._minibatchStartTime = now;

        setTimeout(() => {
            if (this._minibatch.length > 0)
                this._flushRequest();
        }, MAX_LATENCY);
    }

    private _addRequest(ex : Example, task : string) {
        const now = Date.now();
        if (this._minibatch.length === 0) {
            this._startRequest(ex, task, now);
        } else if (this._minibatchTask === task &&
            (now - this._minibatchStartTime < MAX_LATENCY) &&
            this._minibatch.length < MINIBATCH_SIZE) {
            this._minibatch.push(ex);
        } else {
            this._flushRequest();
            this._startRequest(ex, task, now);
        }
    }

    predict(context : string, question = DEFAULT_QUESTION, answer ?: string, task = 'almond', example_id ?: string) : Promise<PredictionCandidate[]> {
        assert(typeof context === 'string');
        assert(typeof question === 'string');

        // ensure we have a worker, in case it recently died
        if (!this._worker)
            this.start();

        let resolve ! : (data : PredictionCandidate[]) => void,
            reject ! : (err : Error) => void;
        const promise = new Promise<PredictionCandidate[]>((_resolve, _reject) => {
            resolve = _resolve;
            reject = _reject;
        });
        this._addRequest({ context, question, answer, resolve, reject }, task);

        return promise;
    }

    start() {
        let worker : RemoteWorker|LocalWorker;
        if (/^kf\+https?:/.test(this._modeldir)) {
            worker = new RemoteWorker(this._modeldir.substring('kf+'.length));
        } else {
            assert(this._modeldir.startsWith('file://'));
            worker = new LocalWorker(this._modeldir.substring('file://'.length));
        }

        worker.on('error', (error : Error) => {
            if (!this._stopped)
                console.error(`Prediction worker had an error: ${error.message}`);
            this._worker = null;

            // fail all the requests in the minibatch if the worker is hosed
            for (const ex of this._minibatch)
                ex.reject(error);
            this._minibatch = [];
            this._minibatchStartTime = 0;
            this._minibatchTask = '';

            worker.stop();
        });
        worker.start();

        this._worker = worker;
    }

    stop() {
        this._stopped = true;
        if (this._worker)
            this._worker.stop();
    }

    reload() {
        // stop the worker, if any
        if (this._worker)
            this._worker.stop();

        // start again
        this.start();
    }
}
