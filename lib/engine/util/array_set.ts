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

/**
 * A Set-like class that uses an Array as backing store, and thus can
 * be stored transparently to and from JSON.
 */
export default class ArraySet<S> {
    private store : S[];

    constructor(store ?: S[]) {
        this.store = store || [];
    }
    toJSON() {
        return this.store;
    }
    get size() {
        return this.store.length;
    }
    add(elem : S) : boolean {
        const idx = this.store.indexOf(elem);
        if (idx >= 0)
            return false;
        this.store.push(elem);
        return true;
    }
    delete(elem : S) : boolean {
        const idx = this.store.indexOf(elem);
        if (idx < 0)
            return false;
        this.store.splice(idx, 1);
        return true;
    }
    has(elem : S) : boolean {
        return this.store.indexOf(elem) >= 0;
    }
    clear() {
        this.store = [];
    }
    forEach<T>(callback : (this : T, key : S, value : S, set : this) => void, thisArg : T) : void;
    forEach(callback : (key : S, value : S, set : this) => void) : void;
    forEach(callback : (this : any, key : S, value : S, set : this) => void, thisArg ?: any) {
        this.store.forEach((value) => {
            callback.call(thisArg, value, value, this);
        });
    }

    values() : Iterable<S> {
        return this.store;
    }
    keys() : Iterable<S> {
        return this.values();
    }
    [Symbol.iterator]() : Iterator<S> {
        return this.store[Symbol.iterator]();
    }
}
