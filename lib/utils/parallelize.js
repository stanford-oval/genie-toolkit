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

const Stream = require('stream');

let Worker;
try {
    Worker = require('worker_threads').Worker;
} catch(e) {
    Worker = null;
}

function singleparallelize(workerPath, args) {
    const worker = require(workerPath);
    return worker(args, 0);
}

module.exports = function parallelize(N, workerPath, args) {
    if (N <= 0)
        N = 1;
    if (N === 1 || Worker === null) {
        if (N !== 1)
            console.error('Worker thread support not available, falling back to single-threaded execution');
        return singleparallelize(workerPath, args);
    }

    let workers = [];
    for (let i = 0; i < N; i++) {
        workers.push(new Worker(require.resolve('./parallelize-worker'), {
            workerData: { args, workerPath, shard: i },
        }));
    }

    // round robin
    let rr = 0;
    const stream = new Stream.Duplex({
        objectMode: true,

        read() {},
        write(data, encoding, callback) {
            workers[rr].postMessage({ data, end: false });
            rr = (rr+1) % N;
            callback();
        },
        final(callback) {
            for (let worker of workers)
                worker.postMessage({ data: undefined, end: true });
            callback();
        }
    });

    let waitCount = N;
    for (let worker of workers) {
        worker.on('message', (msg) => {
            if (msg.data) {
                stream.push(msg.data);
            } else if (msg.end) {
                waitCount--;
                if (waitCount === 0)
                    stream.push(null);
            } else {
                throw new Error('unrecognized message: ' + JSON.stringify(msg));
            }
        });
        worker.on('error', (e) => {
            stream.emit('error', e);
        });
    }

    return stream;
};
