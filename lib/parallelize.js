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
