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

class ArrayAccumulator extends Stream.Writable {
    constructor() {
        super({ objectMode: true });

        this._buffer = [];
    }

    _write(obj, encoding, callback) {
        this._buffer.push(obj);
        callback();
    }

    read() {
        return new Promise((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

class MapAccumulator extends Stream.Writable {
    constructor() {
        super({ objectMode: true });

        this._buffer = new Map;
    }

    _write(obj, encoding, callback) {
        this._buffer.set(obj.id, obj);
        callback();
    }

    read() {
        return new Promise((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

class ArrayStream extends Stream.Readable {
    constructor(array) {
        super({ objectMode: true });

        this._iterator = array[Symbol.iterator]();
    }

    _read() {
        for (;;) {
            const { value, done } = this._iterator.next();
            if (done) {
                this.push(null);
                break;
            }

            const ok = this.push(value);
            if (!ok)
                break;
        }
    }
}

module.exports = {
    ArrayAccumulator,
    ArrayStream,
    MapAccumulator,

    waitFinish(stream) {
        return new Promise((resolve, reject) => {
            stream.once('finish', resolve);
            stream.on('error', reject);
        });
    }
};
