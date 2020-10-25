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


import assert from 'assert';
import * as events from 'events';
import * as child_process from 'child_process';

import JsonDatagramSocket from '../utils/json_datagram_socket';

const DEFAULT_QUESTION = 'translate from english to thingtalk';

class Worker extends events.EventEmitter {
    constructor(id, modeldir) {
        super();

        this.id = id;
        this._child = null;
        this._hadError = false;
        this._stream = null;
        this._nextId = 0;
        this._requests = new Map;

        this._modeldir = modeldir;
    }

    get ok() {
        return this._child !== null && !this._hadError;
    }

    get busy() {
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

        this._stream = new JsonDatagramSocket(this._child.stdout, this._child.stdin, 'utf8');

        this._stream.on('error', (e) => {
            this._failAll(e);
            this._hadError = true;
            this.emit('error', e);
        });
        this._stream.on('data', (msg) => {
            if (msg.error) {
                this._requests.get(msg.id).reject(new Error(msg.error));
            } else if (msg.candidates) {
                this._requests.get(msg.id).resolve(msg.candidates);
            } else {
                // no beam search, hence only one candidate, and fixed score
                this._requests.get(msg.id).resolve([{
                    answer: msg.answer,
                    score: 1
                }]);
            }
            this._requests.delete(msg.id);
        });
    }

    _failAll(error) {
        for (let { reject } of this._requests.values())
            reject(error);
        this._requests.clear();
    }

    request(task, context, question, answer) {
        const id = this._nextId ++;

        let resolve, reject;
        const promise = new Promise((_resolve, _reject) => {
            resolve = _resolve;
            reject = _reject;
        });
        this._requests.set(id, { resolve, reject });

        assert(typeof context === 'string');
        assert(typeof question === 'string');
        this._stream.write({ id, context, question, answer, task });
        return promise;
    }
}

export default class Predictor {
    constructor(id, modeldir, nWorkers = 1) {
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

    _killall() {
        for (let worker of this._workers)
            worker.stop();
    }

    reload() {
        // stop all workers and clear them up
        this._killall();
        this._workers.clear();

        // start again
        this.start();
    }

    _startWorker() {
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

    predict(context, question = DEFAULT_QUESTION, answer, task = 'almond') {
        // first pick a worker that is free
        for (let worker of this._workers) {
            if (worker.ok && !worker.busy)
                return worker.request(task, context, question, answer);
        }

        // failing that, pick any worker that is alive
        for (let worker of this._workers) {
            if (worker.ok)
                return worker.request(task, context, question, answer);
        }

        // failing that, spawn a new worker
        return this._startWorker().request(task, context, question, answer);
    }
}
