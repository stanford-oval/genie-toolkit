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

const INTENTS = new Set([
    'null',
    'greet',
    'init_request',
    'second_request',
    'insist',
    'accept',
    'choose',
    'slot_question',
    'info_question',
    'answer',
    'cancel',
    'end'
]);

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

class QuestionValue extends Value {
    constructor() {
        super();
    }

    prettyprint() {
        return '?';
    }

    clone() {
        return this; // question values are immutable
    }

    equals(other) {
        return this === other;
    }
}
const QUESTION = new QuestionValue();

class TristateValue extends Value {
    constructor(value) {
        super();
        assert(value === 'yes' || value === 'no' || value === 'dontcare');
        this.value = value;
    }

    prettyprint() {
        return this.value;
    }

    clone() {
        return new TristateValue(this.value);
    }

    equals(other) {
        return other instanceof TristateValue && other.value === this.value;
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

    equals(other) {
        return other instanceof ConstantValue && other.value === this.value;
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

    equals(other) {
        return other instanceof SlotValue && other.symbol === this.symbol;
    }
}

class MaybeValue extends Value {
    constructor(wrapped) {
        super();
        this.wrapped = wrapped;
    }

    prettyprint() {
        return 'maybe ' + this.wrapped.prettyprint();
    }

    clone() {
        return new MaybeValue(this.wrapped.clone());
    }

    equals(other) {
        return other instanceof MaybeValue && this.wrapped.equals(other.wrapped);
    }
}

class DialogState extends AstNode {
    constructor(domain = null) {
        super();
        this.store = new Map;

        this.intent = null;
        this.domain = domain;

        this._cachedHasQuestion = undefined;
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

    prettyprint() {
        if (this.intent === null)
            throw new Error('must set intent before calling prettyprint()');
        assert(INTENTS.has(this.intent));
        assert(this.domain !== 'mixed');

        const keys = Array.from(this.store.keys());
        keys.sort();

        let buffer = [this.intent];
        if (this.domain !== null)
            buffer.push(this.domain);
        else
            assert(keys.length === 0 && this.intent === 'greet' || this.intent === 'null');
        for (let key of keys)
            buffer.push(key.replace(/-/g, ' '), 'is', this.store.get(key).prettyprint());
        return buffer.join(' ');
    }

    clone() {
        let newstate = new DialogState;
        newstate.intent = this.intent;
        newstate.domain = this.domain;
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
        if (this.domain === null)
            this.domain = domain;
        else if (domain !== this.domain)
            this.domain = 'mixed';

        if (value === QUESTION)
            this._cachedHasQuestion = true;

        // if this slot was previously a question, we might still have a question
        // mark that we should recompute the next time anyone asks
        if (this.store.get(key) === QUESTION)
            this._cachedHasQuestion = undefined;
        this.store.set(key, value);
    }

    hasQuestion() {
        if (this._cachedHasQuestion !== undefined)
            return this._cachedHasQuestion;
        for (let value of this.store.values()) {
            if (value === QUESTION)
                return this._cachedHasQuestion = true;
        }
        return this._cachedHasQuestion = false;
    }
}

module.exports = {
    INTENTS,
    AstNode,
    Value,
    TristateValue,
    ConstantValue,
    SlotValue,
    MaybeValue,
    QUESTION,
    DialogState,
};
