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

import { Ast, Type } from 'thingtalk';

import { FilterSlot, isSameFunction } from './utils';

class SlotBag {
    schema : Ast.FunctionDef|null;
    store : Map<string, Ast.Value>;

    constructor(schema : Ast.FunctionDef|null) {
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
    get(key : string) : Ast.Value|undefined {
        return this.store.get(key);
    }
    has(key : string) : boolean {
        return this.store.has(key);
    }
    keys() : Iterable<string> {
        return this.store.keys();
    }
    values() : Iterable<Ast.Value> {
        return this.store.values();
    }
    [Symbol.iterator]() : IterableIterator<[string, Ast.Value]> {
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

function checkAndAddSlot(bag : SlotBag, filter : FilterSlot) : SlotBag|null {
    assert(bag instanceof SlotBag);
    if (!(filter.ast instanceof Ast.AtomBooleanExpression))
        return null;
    const schema = bag.schema!;
    if (!isSameFunction(schema, filter.schema))
        return null;
    const arg = schema!.getArgument(filter.ast.name);
    if (!arg || arg.is_input)
        return null;
    const ptype = arg.type;
    assert(ptype.equals(filter.ptype));
    const vtype = filter.ast.value.getType();
    if (filter.ast.operator === 'contains' || filter.ast.operator === 'contains~') {
        if (!ptype.equals(new Type.Array(vtype)))
            return null;
        const clone = bag.clone();
        if (clone.has(filter.ast.name))
            return null;
        else
            clone.set(filter.ast.name, new Ast.Value.Array([filter.ast.value]));
        return clone;
    } else {
        if (filter.ast.operator !== '==' && filter.ast.operator !== '=~')
            return null;
        if (!ptype.equals(vtype))
            return null;
        if (bag.has(filter.ast.name))
            return null;
        const clone = bag.clone();
        clone.set(filter.ast.name, filter.ast.value);
        return clone;
    }
}


export {
    SlotBag,
    checkAndAddSlot,
};
