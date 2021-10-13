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
import * as Stream from 'stream';

type WriteCallback = (err ?: Error) => void;

class ArrayAccumulator<T> extends Stream.Writable implements Stream.Writable {
    private _buffer : T[];

    constructor() {
        super({ objectMode: true });

        this._buffer = [];
    }

    _write(obj : T, encoding : BufferEncoding, callback : WriteCallback) : void {
        this._buffer.push(obj);
        callback();
    }

    read() : Promise<T[]> {
        return new Promise((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

class SetAccumulator<T> extends Stream.Writable implements Stream.Writable {
    private _buffer : Set<T>;

    constructor() {
        super({ objectMode: true });

        this._buffer = new Set;
    }

    _write(obj : T, encoding : BufferEncoding, callback : WriteCallback) : void {
        this._buffer.add(obj);
        callback();
    }

    read() : Promise<Set<T>> {
        return new Promise((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

class MapAccumulator<V, F extends keyof V> extends Stream.Writable implements Stream.Writable {
    _buffer : Map<V[F], V>;
    _field : F;

    constructor(field : F = 'id' as F) {
        super({ objectMode: true });

        this._buffer = new Map;
        this._field = field;
    }

    _write(obj : V, encoding : BufferEncoding, callback : WriteCallback) : void {
        this._buffer.set(obj[this._field], obj);
        callback();
    }

    read() : Promise<Map<V[F], V>> {
        return new Promise((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

class ArrayStream<T> extends Stream.Readable implements Stream.Readable {
    private _iterator : Iterator<T>;

    constructor(array : T[], options : Stream.ReadableOptions) {
        super(options);

        this._iterator = array[Symbol.iterator]();
    }

    _read() : void {
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

interface ChainStreamOptions extends Stream.ReadableOptions {
    separator ?: string|Buffer;
}

interface InternalReadableStream extends Stream.Readable {
    _readableState : {
        length : number;
        ended : number;
    };
}

class ChainStream extends Stream.Readable implements Stream.Readable {
    private _chain : Stream.Readable[];
    private _separator ?: string|Buffer;
    private _i : number;

    constructor(chain : Stream.Readable[], options : ChainStreamOptions) {
        super(options);

        this._chain = chain;
        this._separator = options.separator;
        this._i = 0;
    }

    _read(n : number) : void {
        if (this._i >= this._chain.length) {
            this.push(null);
            return;
        }

        const next = this._chain[this._i] as InternalReadableStream;
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

function chain(streams : Stream.Readable[], options : ChainStreamOptions) : ChainStream {
    return new ChainStream(streams, options);
}

class CountStream<T> extends Stream.Duplex {
    private _buffer : T[];
    private _N : number;
    private _i : number;
    private _reading : boolean;

    constructor() {
        super({ objectMode: true });

        this._buffer = [];
        this._i = 0;
        this._N = 0;
        this._reading = false;
    }

    _read() : void {
        if (!this._reading)
            return;
        this._pushSome();
    }

    private _pushSome() {
        let consumed : number;
        while (this._i < this._buffer.length && this.push(this._buffer[this._i++])) {
            consumed = this._i;
            if (consumed % 100 === 0)
                this.emit('progress', consumed/this._N);
        }
        consumed = this._i;
        if (consumed % 100 === 0)
            this.emit('progress', consumed/this._N);
        if (this._i === this._buffer.length) {
            this.emit('progress', 1);
            this.push(null);
        }
    }

    _write(obj : T, encoding : BufferEncoding, callback : WriteCallback) : void {
        this._buffer.push(obj);
        this._N++;
        callback();
    }

    _final(callback : WriteCallback) : void {
        this._reading = true;
        this._pushSome();
        callback();
    }
}

export {
    ArrayAccumulator,
    ArrayStream,
    SetAccumulator,
    MapAccumulator,
    chain,
    CountStream,
};

export function waitFinish(stream : NodeJS.WritableStream) : Promise<void> {
    return new Promise((resolve, reject) => {
        stream.once('finish', resolve);
        stream.on('error', reject);
    });
}

export function waitEnd(stream : NodeJS.ReadableStream) : Promise<void> {
    return new Promise((resolve, reject) => {
        stream.once('end', resolve);
        stream.on('error', reject);
    });
}