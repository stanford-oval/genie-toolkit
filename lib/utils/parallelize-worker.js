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

(async function main() {
    const Stream = require('stream');
    const { workerData, parentPort } = require('worker_threads');

    const worker = require(workerData.workerPath);
    const stream = await worker(workerData.args, workerData.shard);

    const input = new Stream.Readable({
        objectMode: true,

        read() {}
    });
    parentPort.on('message', (msg) => {
        if (msg.data)
            input.push(msg.data);
        else if (msg.end)
            input.push(null);
        else
            throw new Error('unrecognized message: ' + JSON.stringify(msg));
    });

    const output = new Stream.Writable({
        objectMode: true,

        write(data, encoding, callback) {
            parentPort.postMessage({ data, end: false });
            callback();
        },
        final(callback) {
            parentPort.postMessage({ data: undefined, end: true });
            process.nextTick(() => {
                parentPort.close();
                callback();
            });
        }
    });

    input.pipe(stream).pipe(output);
})();
