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

class SetAccumulator extends Stream.Writable {
    constructor() {
        super({ objectMode: true });

        this._buffer = new Set;
    }

    _write(obj, encoding, callback) {
        this._buffer.add(obj);
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
    constructor(field = 'id') {
        super({ objectMode: true });

        this._buffer = new Map;
        this._field = field;
    }

    _write(obj, encoding, callback) {
        this._buffer.set(obj[this._field], obj);
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
    constructor(array, options) {
        super(options);

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

class ChainStream extends Stream.Readable {
    constructor(chain, options) {
        super(options);

        this._chain = chain;
        this._separator = options.separator;
        this._i = 0;
    }

    _read(n) {
        if (this._i >= this._chain.length) {
            this.push(null);
            return;
        }

        let next = this._chain[this._i];
        let chunk = next.read(n);
        if (chunk !== null) {
            this.push(chunk);
            return;
        }

        // ReadableStream.read returns null in three cases:
        //
        // - the stream is open and there is not enough data to read (ended === false)
        // - the stream is ended, there is data left but not enough to read
        // - the stream is ended and there is nothing left ('end' has been emitted)
        //
        // in the first case, we want to connect to readable and read more later
        // when data shows up
        //
        // in the second case, we want to consume as much data as possible,
        // then try to read the rest from the next stream
        //
        // in the third case, we want to switch to the next stream right away
        // and try to read more

        if (!next._readableState.ended) {
            // first case
            next.once('readable', () => this._read(n));
        } else if (next._readableState.length > 0) {
            // second case

            chunk = next.read(next._readableState.length);
            assert(chunk !== null);
            this.push(chunk);

            // stream has ended and we consumed all data, switch to the next one
            this._i ++;
            if (this._i < this._chain.length && this._separator)
                this.push(this._separator);
            process.nextTick(() => this._read(n - chunk.length));
        } else {
            // third case

            // stream has ended and we consumed all data, switch to the next one
            this._i ++;
            if (this._i < this._chain.length && this._separator)
                this.push(this._separator);
            process.nextTick(() => this._read(n));
        }
    }
}

function chain(streams, options) {
    return new ChainStream(streams, options);
}

class CountStream extends Stream.Duplex {
    constructor() {
        super({ objectMode: true });

        this._buffer = [];
        this._N = 0;
        this._reading = false;
    }

    _read() {
        if (!this._reading)
            return;
        this._pushSome();
    }

    _pushSome() {
        while (this._buffer.length > 0 && this.push(this._buffer.shift())) {
            const consumed = this._N - this._buffer.length;
            if (consumed % 100 === 0)
                this.emit('progress', consumed/this._N);
        }
        const consumed = this._N - this._buffer.length;
        if (consumed % 100 === 0)
            this.emit('progress', consumed/this._N);
        if (this._buffer.length === 0) {
            this.emit('progress', 1);
            this.push(null);
        }
    }

    _write(obj, encoding, callback) {
        this._buffer.push(obj);
        this._N++;
        callback();
    }

    _final(callback) {
        this._reading = true;
        this._pushSome();
        callback();
    }
}

module.exports = {
    ArrayAccumulator,
    ArrayStream,
    SetAccumulator,
    MapAccumulator,
    chain,
    CountStream,

    waitFinish(stream) {
        return new Promise((resolve, reject) => {
            stream.once('finish', resolve);
            stream.on('error', reject);
        });
    }
};
