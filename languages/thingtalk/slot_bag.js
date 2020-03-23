// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

class SlotBag {
    constructor(schema) {
        this.schema = schema;
        this.store = new Map;
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
    const ptype = bag.schema.getArgType(filter.name);
    if (!ptype)
        return null;
    const vtype = filter.value.getType();
    if (filter.operator === 'contains' || filter.operator === 'contains~') {
        if (!ptype.equals(new Type.Array(vtype)))
            return null;
        const clone = bag.clone();
        if (clone.has(filter.name))
            clone.get(filter.name).value.push(filter.value);
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


module.exports = {
    SlotBag,
    checkAndAddSlot,
};
