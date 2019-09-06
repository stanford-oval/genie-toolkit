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
const { workerData, parentPort } = require('worker_threads');

const worker = require(workerData.workerPath);
const stream = worker(workerData.args, workerData.shard);

const input = new Stream.Readable({
    objectMode: true,
    highWaterMark: 1000,

    read() {
        parentPort.postMessage({ busy: false });
    }
});
parentPort.on('message', (msg) => {
    let ok;
    if (msg.data)
        ok = input.push(msg.data);
    else if (msg.end)
        ok = input.push(null);
    else
        throw new Error('unrecognized message: ' + JSON.stringify(msg));
    if (!ok)
        parentPort.postMessage({ busy: true });
});

const output = new Stream.Writable({
    objectMode: true,

    write(data, encoding, callback) {
        parentPort.postMessage({ data, end: false });
        callback();
    },
    final(callback) {
        parentPort.postMessage({ data: undefined, end: true });
        callback();
    }
});

input.pipe(stream).pipe(output);
