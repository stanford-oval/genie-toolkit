// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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

const INTENTS = new Set([
    'null',
    'greet',
    'init_request',
    'second_request',
    'ask_recommend',
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
abstract class AstNode {
    abstract prettyprint() : string;
    abstract clone() : AstNode;

    optimize() : this {
        return this;
    }
}

abstract class Value extends AstNode {
    abstract equals(x : AstNode) : boolean;
    abstract clone() : Value;
}

class QuestionValue extends Value {
    constructor() {
        super();
    }

    prettyprint() : string {
        return '?';
    }

    clone() : this {
        return this; // question values are immutable
    }

    equals(other : AstNode) : boolean {
        return this === other;
    }
}
const QUESTION = new QuestionValue();

class TristateValue extends Value {
    value : 'yes'|'no'|'dontcare';

    constructor(value : 'yes'|'no'|'dontcare') {
        super();
        assert(value === 'yes' || value === 'no' || value === 'dontcare');
        this.value = value;
    }

    prettyprint() : string {
        return this.value;
    }

    clone() : TristateValue {
        return new TristateValue(this.value);
    }

    equals(other : AstNode) : boolean {
        return other instanceof TristateValue && other.value === this.value;
    }
}

class ConstantValue extends Value {
    value : string|number|boolean;

    constructor(value : string|number|boolean) {
        super();
        this.value = value;
    }

    prettyprint() : string {
        return '" ' + this.value + ' "';
    }

    clone() : ConstantValue {
        return new ConstantValue(this.value);
    }

    equals(other : AstNode) : boolean {
        return other instanceof ConstantValue && other.value === this.value;
    }
}

class SlotValue extends Value {
    symbol : string;

    constructor(symbol : string) {
        super();
        assert(symbol.startsWith('SLOT_'));
        this.symbol = symbol;
    }

    prettyprint() : string {
        return this.symbol;
    }

    clone() : SlotValue {
        return new SlotValue(this.symbol);
    }

    equals(other : AstNode) : boolean {
        return other instanceof SlotValue && other.symbol === this.symbol;
    }
}

class MaybeValue extends Value {
    wrapped : Value;

    constructor(wrapped : Value) {
        super();
        this.wrapped = wrapped;
    }

    prettyprint() : string {
        return 'maybe ' + this.wrapped.prettyprint();
    }

    clone() : MaybeValue {
        return new MaybeValue(this.wrapped.clone());
    }

    equals(other : AstNode) : boolean {
        return other instanceof MaybeValue && this.wrapped.equals(other.wrapped);
    }
}

class DialogState extends AstNode {
    intent : string|null;
    domain : string|null;
    store : Map<string, Value>;
    private _cachedHasQuestion : boolean|undefined;

    constructor(domain : string|null = null) {
        super();
        this.store = new Map;

        this.intent = null;
        this.domain = domain;

        this._cachedHasQuestion = undefined;
    }

    get size() : number {
        return this.store.size;
    }
    entries() : Iterable<[string, Value]> {
        return this.store.entries();
    }
    get(key : string) : Value|undefined {
        return this.store.get(key);
    }
    has(key : string) : boolean {
        return this.store.has(key);
    }
    keys() : Iterable<string> {
        return this.store.keys();
    }
    values() : Iterable<Value> {
        return this.store.values();
    }
    [Symbol.iterator]() : Iterable<[string, Value]> {
        return this.store[Symbol.iterator]();
    }

    prettyprint() : string {
        if (this.intent === null)
            throw new Error('must set intent before calling prettyprint()');
        assert(INTENTS.has(this.intent));
        //assert(this.domain !== 'mixed');

        const keys = Array.from(this.store.keys());
        keys.sort();

        const buffer : string[] = [this.intent];
        if (this.domain !== null)
            buffer.push(this.domain);
        else
            assert(keys.length === 0 && this.intent === 'greet' || this.intent === 'null');
        for (const key of keys)
            buffer.push(key.replace(/-/g, ' '), 'is', this.store.get(key)!.prettyprint());
        return buffer.join(' ');
    }

    clone() : DialogState {
        const newstate = new DialogState;
        newstate.intent = this.intent;
        newstate.domain = this.domain;
        for (const [key, value] of this.entries())
            newstate.set(key, value);
        return newstate;
    }

    clear() : void {
        return this.store.clear();
    }
    delete(key : string) : boolean {
        return this.store.delete(key);
    }
    set(key : string, value : Value) : void {
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

    hasQuestion() : boolean {
        if (this._cachedHasQuestion !== undefined)
            return this._cachedHasQuestion;
        for (const value of this.store.values()) {
            if (value === QUESTION)
                return this._cachedHasQuestion = true;
        }
        return this._cachedHasQuestion = false;
    }
}

export {
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
