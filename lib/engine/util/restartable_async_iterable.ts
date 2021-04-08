// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

/**
 * An async iterable data-structure that wraps another async-iterable
 * so that iteration happens lazily, but can be restarted at any time.
 *
 * Multiple callers can iterate the same iterable concurrently.
 */
export default class RestartableAsyncIterable<T> {
    private _cache : T[] = [];
    private _done = false;
    private _iterator : Iterator<T>|AsyncIterator<T>;
    private _nextPromise : Promise<IteratorResult<T>>|null = null;

    constructor(inner : Iterable<T>|AsyncIterable<T>) {
        if (typeof (inner as any)[Symbol.asyncIterator] === 'function')
            this._iterator = (inner as AsyncIterable<T>)[Symbol.asyncIterator]();
        else
            this._iterator = (inner as Iterable<T>)[Symbol.iterator]();
    }

    [Symbol.asyncIterator]() : AsyncIterator<T> {
        const self = this;
        const iterator = {
            _index: 0,
            async next() : Promise<IteratorResult<T>> {
                // first return the cached values
                if (this._index < self._cache.length) {
                    const value = self._cache[this._index++];
                    return { value, done: false };
                }
                // try to get more values from the underlying iterable
                const result = await self._next();
                // if there is a value, _next() will increment the cache
                // make sure we skip that value at the next iteration
                if (!result.done)
                    this._index++;
                return result;
            },
            [Symbol.asyncIterator]() {
                return this;
            }
        };
        return iterator;
    }

    private async _internalNextElement() {
        const next = await this._iterator.next();
        if (next.done)
            this._done = true;
        else
            this._cache.push(next.value);
        this._nextPromise = null;
        return next;
    }

    private async _next() : Promise<IteratorResult<T>> {
        if (this._done)
            return { value: undefined, done: true };
        if (!this._nextPromise)
            this._nextPromise = this._internalNextElement();
        return this._nextPromise;
    }
}
