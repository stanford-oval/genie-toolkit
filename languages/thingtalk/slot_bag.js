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

import assert from 'assert';

import { Ast, Type } from 'thingtalk';

import { isSameFunction } from './utils';

class SlotBag {
    constructor(schema) {
        this.schema = schema;
        this.store = new Map;
    }

    static merge(b1, b2) {
        if (b1.schema !== null && b2.schema !== null && !isSameFunction(b1.schema, b2.schema))
            return null;
        const newbag = new SlotBag(b1.schema || b2.schema);
        for (let [key, value] of b1.entries())
            newbag.set(key, value.clone());
        for (let [key, value] of b2.entries()) {
            if (newbag.has(key))
                return null;
            newbag.set(key, value.clone());
        }
        return newbag;
    }

    clone() {
        let newbag = new SlotBag(this.schema);
        for (let [key, value] of this.entries())
            newbag.set(key, value.clone());
        return newbag;
    }

    get size() {
        return this.store.size;
    }
    entries() {
        return this.store.entries();
    }
    get(key) {
        return this.store.get(key);
    }
    has(key) {
        return this.store.has(key);
    }
    keys() {
        return this.store.keys();
    }
    values() {
        return this.store.values();
    }
    [Symbol.iterator]() {
        return this.store[Symbol.iterator]();
    }
    set(key, value) {
        assert(value instanceof Ast.Value);
        this.store.set(key, value);
    }
    clear() {
        return this.store.clear();
    }
    delete(key) {
        return this.store.delete(key);
    }
}

function checkAndAddSlot(bag, filter) {
    assert(bag instanceof SlotBag);
    if (!filter.isAtom)
        return null;
    const arg = bag.schema.getArgument(filter.name);
    if (!arg || arg.is_input)
        return null;
    const ptype = arg.type;
    if (!ptype)
        return null;
    const vtype = filter.value.getType();
    if (filter.operator === 'contains' || filter.operator === 'contains~') {
        if (!ptype.equals(new Type.Array(vtype)))
            return null;
        const clone = bag.clone();
        if (clone.has(filter.name))
            return null;
        else
            clone.set(filter.name, new Ast.Value.Array([filter.value]));
        return clone;
    } else {
        if (filter.operator !== '==' && filter.operator !== '=~')
            return null;
        if (!ptype.equals(vtype))
            return null;
        if (bag.has(filter.name))
            return null;
        const clone = bag.clone();
        clone.set(filter.name, filter.value);
        return clone;
    }
}


export {
    SlotBag,
    checkAndAddSlot,
};
