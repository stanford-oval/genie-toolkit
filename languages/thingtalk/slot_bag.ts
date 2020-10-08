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
"use strict";

import assert from 'assert';

import { Ast, Type } from 'thingtalk';

import { isSameFunction } from './utils';

class SlotBag {
    schema : Ast.ExpressionSignature|null;
    store : Map<string, Ast.Value>;

    constructor(schema : Ast.ExpressionSignature|null) {
        this.schema = schema;
        this.store = new Map;
    }

    static merge(b1 : SlotBag, b2 : SlotBag) : SlotBag|null {
        const schema1 = b1.schema;
        const schema2 = b2.schema;
        if (schema1 !== null && schema2 !== null && !isSameFunction(schema1, schema2))
            return null;
        const newbag = new SlotBag(schema1 || schema2);
        for (const [key, value] of b1.entries())
            newbag.set(key, value.clone());
        for (const [key, value] of b2.entries()) {
            if (newbag.has(key))
                return null;
            newbag.set(key, value.clone());
        }
        return newbag;
    }

    clone() : SlotBag {
        const newbag = new SlotBag(this.schema);
        for (const [key, value] of this.entries())
            newbag.set(key, value.clone());
        return newbag;
    }

    get size() : number {
        return this.store.size;
    }
    entries() : Iterable<[string, Ast.Value]> {
        return this.store.entries();
    }
    get(key) : Ast.Value|undefined {
        return this.store.get(key);
    }
    has(key) : boolean {
        return this.store.has(key);
    }
    keys() : Iterable<string> {
        return this.store.keys();
    }
    values() : Iterable<Ast.Value> {
        return this.store.values();
    }
    [Symbol.iterator]() : Iterable<[string, Ast.Value]> {
        return this.store[Symbol.iterator]();
    }
    set(key : string, value : Ast.Value) : void {
        assert(value instanceof Ast.Value);
        this.store.set(key, value);
    }
    clear() : void {
        return this.store.clear();
    }
    delete(key : string) : boolean {
        return this.store.delete(key);
    }
}

function checkAndAddSlot(bag : SlotBag, filter : Ast.BooleanExpression) : SlotBag|null {
    assert(bag instanceof SlotBag);
    if (!(filter instanceof Ast.AtomBooleanExpression))
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
