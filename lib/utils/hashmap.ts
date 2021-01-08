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

// Implementation of Map that supports custom hashable objects

export interface Hashable<T> {
    hash() : number;
    equals(other : T) : boolean;
}

interface Node<Key, Value> {
    key : Key;
    value : Value;
}

type PrimitiveType = string|number|boolean;
type HashableType<Key> = PrimitiveType|Hashable<Key>;

export class HashMap<Key extends HashableType<Key>, Value> {
    private store : Map<PrimitiveType, Array<Node<Key, Value>>>;
    private _size : number;

    constructor(iterable ?: Iterable<[Key, Value]>) {
        this.store = new Map;
        this._size = 0;

        if (iterable) {
            for (const [key, value] of iterable)
                this.set(key, value);
        }
    }

    get size() {
        return this._size;
    }

    private _hash(key : HashableType<Key>) : PrimitiveType {
        if (typeof key === 'object')
            return key.hash();
        else
            return key;
    }

    private _equals(key1 : HashableType<Key>, key2 : Key) : boolean {
        if (typeof key1 === 'object')
            return key1.equals(key2);
        else
            return key1 === key2;
    }

    get(key : Key) : Value|undefined {
        const bucket = this.store.get(this._hash(key));
        if (!bucket)
            return undefined;
        for (const node of bucket) {
            if (this._equals(node.key, key))
                return node.value;
        }
        return undefined;
    }

    has(key : Key) : boolean {
        const bucket = this.store.get(this._hash(key));
        if (!bucket)
            return false;
        for (const node of bucket) {
            if (this._equals(node.key, key))
                return true;
        }
        return false;
    }

    set(key : Key, value : Value) : this {
        const hash = this._hash(key);
        const bucket = this.store.get(hash);
        if (bucket) {
            for (const node of bucket) {
                if (this._equals(node.key, key)) {
                    node.value = value;
                    return this;
                }
            }

            bucket.push({ key, value });
            this._size ++;
        } else {
            this.store.set(hash, [{ key, value }]);
            this._size ++;
        }
        return this;
    }

    delete(key : Key) {
        const hash = this._hash(key);
        const bucket = this.store.get(hash);
        if (bucket) {
            let found = false;
            this.store.set(hash, bucket.filter((node) => {
                if (this._equals(node.key, key)) {
                    found = true;
                    return false;
                } else {
                    return true;
                }
            }));
            if (found)
                this._size --;
            return found;
        } else {
            return false;
        }
    }

    clear() {
        this.store.clear();
        this._size = 0;
    }

    *entries() : IterableIterator<[Key, Value]> {
        for (const bucket of this.store.values()) {
            for (const node of bucket)
                yield [node.key, node.value];
        }
    }

    forEach<ThisArg>(cb : (this : ThisArg, value : Value, key : Key, map : HashMap<Key, Value>) => void, thisArg : ThisArg) : void;
    forEach(cb : (value : Value, key : Key, map : HashMap<Key, Value>) => void) : void;
    forEach(cb : (this : any, value : Value, key : Key, map : HashMap<Key, Value>) => void, thisArg ?: any) {
        for (const [key, value] of this)
            cb.call(thisArg, value, key, this);
    }

    [Symbol.iterator]() {
        return this.entries();
    }

    *keys() : Iterable<Key> {
        for (const [key,] of this)
            yield key;
    }

    *values() : Iterable<Value> {
        for (const [,value] of this)
            yield value;
    }
}
