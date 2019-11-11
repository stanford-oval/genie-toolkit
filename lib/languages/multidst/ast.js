// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

// minimal AST classes
class AstNode {
    /* instanbul ignore next */
    prettyprint() {
        throw new Error('not implemented');
    }

    optimize() {
        return this;
    }
}

class Value extends AstNode {
}

class TristateValue extends Value {
    constructor(value) {
        super();
        this.value = value;
    }

    prettyprint() {
        return this.value;
    }

    clone() {
        return new TristateValue(this.value);
    }
}

class ConstantValue extends Value {
    constructor(value) {
        super();
        this.value = value;
    }

    prettyprint() {
        return '" ' + this.value + ' "';
    }

    clone() {
        return new ConstantValue(this.value);
    }
}

class SlotValue extends Value {
    constructor(symbol) {
        super();
        assert(symbol.startsWith('SLOT_'));
        this.symbol = symbol;
    }

    prettyprint() {
        return this.symbol;
    }

    clone() {
        return new SlotValue(this.symbol);
    }
}

class DialogState extends AstNode {
    constructor(domain = null) {
        super();
        this.store = new Map;

        this._domain = domain;
    }

    get domain() {
        return this._domain;
    }

    get size() {
        return this.store.size;
    }
    entries() {
        return this.store.entries();
    }
    get(key) {
        return this.store.get();
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

    prettyprint() {
        if (this.store.size === 0)
            return 'none';

        const keys = Array.from(this.store.keys());
        keys.sort();

        let buffer = [];
        for (let key of keys)
            buffer.push(key.replace(/-/g, ' '), 'is', this.store.get(key).prettyprint());
        return buffer.join(' ');
    }

    clone() {
        let newstate = new DialogState;
        for (let [key, value] of this.entries())
            newstate.set(key, value);
        return newstate;
    }

    clear() {
        return this.store.clear();
    }
    delete(key) {
        return this.store.delete(key);
    }
    set(key, value) {
        assert(value instanceof Value);
        const domain = key.split('-')[0];
        if (this._domain === null)
            this._domain = domain;
        else if (domain !== this._domain)
            this._domain = 'mixed';
        this.store.set(key, value);
    }
}

module.exports = {
    AstNode,
    Value,
    TristateValue,
    ConstantValue,
    SlotValue,
    DialogState,
};
