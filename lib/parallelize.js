// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
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
    let busy = [];
    for (let i = 0; i < N; i++) {
        busy.push(false);
        workers.push(new Worker(require.resolve('./parallelize-worker'), {
            workerData: { args, workerPath, shard: i },
        }));
    }
    let buffer = null;

    const stream = new Stream.Duplex({
        objectMode: true,

        read() {},
        write(data, encoding, callback) {
            assert(buffer === null);

            // find the first worker that is not busy
            let idx = 0;
            while (idx < N && busy[idx])
                idx++;
            if (idx === N) {
                // all workers are busy, save this data item
                // without calling callback
                buffer = {
                    data, callback
                };
                return;
            }

            workers[idx].postMessage({ data, end: false });
            callback();
        },
        final(callback) {
            for (let worker of workers)
                worker.postMessage({ data: undefined, end: true });
            callback();
        }
    });

    let waitCount = N;
    for (let i = 0; i < workers.length; i++) {
        let worker = workers[i];
        worker.on('message', (msg) => {
            if (Object.prototype.hasOwnProperty.call(msg, 'busy')) {
                busy[i] = msg.busy;
                if (!msg.busy && buffer) {
                    worker.postMessage({ data: buffer.data, end: false });
                    buffer.callback();
                    buffer = null;
                }
            } if (msg.data) {
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
