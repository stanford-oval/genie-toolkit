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


export default class MultiMap<K, V> {
    private _storage : Map<K, V[]>;
    private _size : number;

    constructor(elements : Iterable<[K, V]> = []) {
        this._storage = new Map;
        this._size = 0;

        for (const [key, value] of elements)
            this.put(key, value);
    }

    keys() : Iterable<K> {
        return this._storage.keys();
    }
    *values() : Iterable<V> {
        for (const [,value] of this)
            yield value;
    }
    *[Symbol.iterator]() : Generator<[K, V], void> {
        for (const [key, array] of this._storage) {
            for (const value of array)
                yield [key, value];
        }
    }
    entries() : Iterable<[K, V]> {
        return this[Symbol.iterator]();
    }

    get size() : number {
        return this._size;
    }

    clear() : void {
        this._storage.clear();
        this._size = 0;
    }

    delete(key : K) : void {
        const len = (this._storage.get(key) || []).length;
        this._size -= len;
        this._storage.delete(key);
    }

    forEach<T>(callback : (this : T, value : V, key : K, map : this) => void, thisArg : T) : void {
        this._storage.forEach((valueArray, key) => {
            valueArray.forEach((value) => callback.call(thisArg, value, key, this));
        });
    }

    get(key : K) : readonly V[] {
        return this._storage.get(key) || [];
    }

    has(key : K) : boolean {
        return this._storage.has(key);
    }

    put(key : K, value : V) : number {
        let valueArray = this._storage.get(key);
        if (!valueArray) {
            valueArray = [];
            this._storage.set(key, valueArray);
        }
        valueArray.push(value);
        this._size ++;
        return valueArray.length;
    }
}
