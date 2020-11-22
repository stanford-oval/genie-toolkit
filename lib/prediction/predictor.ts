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

const MINIBATCH_SIZE = 50;
const MAX_LATENCY = 1000; // milliseconds
interface Example {
    context : string;
    question : string;
    answer ?: string;
    example_id ?: string;

    resolve(data : PredictionCandidate[]) : void;
    reject(err : Error) : void;
}

class Worker extends events.EventEmitter {
    id : string;
    private _child : child_process.ChildProcess|null;
    private _hadError : boolean;
    private _stream : JsonDatagramSocket|null;
    private _nextId : 0;
    private _requests : Map<number, Request>;
    private _modeldir : string;

    private _minibatchTask = '';
    private _minibatch : Example[] = [];
    private _minibatchStartTime = 0;

    constructor(id : string, modeldir : string) {
        super();

        this.id = id;
        this._child = null;
        this._hadError = false;
        this._stream = null;
        this._nextId = 0;
        this._requests = new Map;

        this._modeldir = modeldir;
    }

    get ok() : boolean {
        return this._child !== null && !this._hadError;
    }

    get busy() : boolean {
        return this._requests.size > 0;
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
            this._hadError = true;
            this.emit('error', e);
        });
        this._child.on('exit', () => {
            this._failAll(new Error(`Worker died`));
            this._child = null;
            this.emit('exit');
        });

        this._stream = new JsonDatagramSocket(this._child.stdout!, this._child.stdin!, 'utf8');

        this._stream.on('error', (e) => {
            this._failAll(e);
            this._hadError = true;
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

    private _flushRequest() {
        const id = this._nextId ++;

        const minibatch = this._minibatch;
        const task = this._minibatchTask;
        this._minibatch = [];
        this._minibatchTask = '';
        this._minibatchStartTime = 0;

        console.error(`minibatch: ${minibatch.length} instances`);

        const request = {
            resolve(candidates : PredictionCandidate[][]) {
                assert(candidates.length === minibatch.length);
                for (let i = 0; i < minibatch.length; i++)
                    minibatch[i].resolve(candidates[i]);
            },
            reject(err : Error) {
                for (let i = 0; i < minibatch.length; i++)
                    minibatch[i].reject(err);
            }
        };
        this._requests.set(id, request);

        this._stream!.write({ id, task, instances: minibatch.map((ex) => {
            return {
                context: ex.context,
                question: ex.question,
                answer: ex.answer,
                example_id: ex.example_id
            };
        }) });
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

    request(task : string, context : string, question : string, answer ?: string, example_id ?: string) : Promise<PredictionCandidate[]> {
        assert(typeof context === 'string');
        assert(typeof question === 'string');

        let resolve ! : (data : PredictionCandidate[]) => void,
            reject ! : (err : Error) => void;
        const promise = new Promise<PredictionCandidate[]>((_resolve, _reject) => {
            resolve = _resolve;
            reject = _reject;
        });
        this._addRequest({ context, question, answer, resolve, reject }, task);

        return promise;
    }
}

export default class Predictor {
    id : string;
    private _nWorkers : number;
    private _modeldir : string;
    private _nextId : number;
    private _workers : Set<Worker>;
    private _stopped : boolean;

    constructor(id : string, modeldir : string, nWorkers = 1) {
        this._nWorkers = nWorkers;

        this.id = id;
        this._modeldir = modeldir;
        this._nextId = 0;
        this._workers = new Set;

        this._stopped = false;
    }

    start() {
        //console.log(`Spawning ${this._nWorkers} workers for predictor ${this.id}`);
        for (let i = 0; i < this._nWorkers; i++)
            this._startWorker();
    }

    stop() {
        this._stopped = true;
        this._killall();
    }

    private _killall() {
        for (const worker of this._workers)
            worker.stop();
    }

    reload() {
        // stop all workers and clear them up
        this._killall();
        this._workers.clear();

        // start again
        this.start();
    }

    private _startWorker() {
        const worker = new Worker(`${this.id}/${this._nextId++}`, this._modeldir);
        worker.on('error', (err) => {
            console.error(`Worker ${worker.id} had an error: ${err.message}`);
            worker.stop();
        });
        worker.on('exit', (err) => {
            if (!this._stopped)
                console.error(`Worker ${worker.id} exited`);
            this._workers.delete(worker);

            if (!this._stopped) {
                // wait 30 seconds, then autorespawn the worker
                // this ensures that we don't stay with fewer workers than
                // we should for too long, as that can overload the few workers
                // who are alive, and cause latency issues
                setTimeout(() => {
                    if (this._workers.size < this._nWorkers)
                        this._startWorker();
                }, 30000);
            }
        });

        worker.start();
        this._workers.add(worker);
        return worker;
    }

    predict(context : string, question = DEFAULT_QUESTION, answer ?: string, task = 'almond', example_id ?: string) {
        // first pick a worker that is free
        for (const worker of this._workers) {
            if (worker.ok && !worker.busy)
                return worker.request(task, context, question, answer, example_id);
        }

        // failing that, pick any worker that is alive
        for (const worker of this._workers) {
            if (worker.ok)
                return worker.request(task, context, question, answer, example_id);
        }

        // failing that, spawn a new worker
        return this._startWorker().request(task, context, question, answer, example_id);
    }
}
