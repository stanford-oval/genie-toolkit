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

export default class MultiMap {
    constructor(elements = []) {
        this._storage = new Map;
        this._size = 0;

        for (let [key, value] of elements)
            this.put(key, value);
    }

    keys() {
        return this.store.keys();
    }
    *values() {
        for (let [,value] of this)
            yield value;
    }
    *[Symbol.iterator]() {
        for (let [key, array] of this._storage) {
            for (let value of array)
                yield [key, value];
        }
    }
    entries() {
        return this[Symbol.iterator]();
    }

    get size() {
        return this._size;
    }

    clear() {
        this._storage.clear();
        this._size = 0;
    }

    delete(key) {
        let len = (this._storage.get(key) || []).length;
        this._size -= len;
        this._storage.delete(key);
    }

    forEach(callback, thisArg) {
        this._storage.forEach((valueArray, key) => {
            valueArray.forEach((value) => callback.call(thisArg, value, key, this));
        });
    }

    get(key) {
        return this._storage.get(key) || [];
    }

    has(key) {
        return this._storage.has(key);
    }

    put(key, value) {
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
