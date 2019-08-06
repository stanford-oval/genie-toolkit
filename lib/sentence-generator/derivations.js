// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2017-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

// A numbered constant, eg. QUOTED_STRING_0 or NUMBER_1 or HASHTAG_3
// During generation, this constant is put in the program as a VarRef
// with an unique variable name.
class Constant {
    constructor(symbol, number, type) {
        this.symbol = symbol;
        this.number = number;
        this.type = type;

        const escapedSymbol = symbol.replace(/[:._]/g, (match) => {
            if (match === '_')
                return '__';
            let code = match.charCodeAt(0);
            return code < 16 ? '_0' + code.toString(16) : '_' + code.toString(16);
        });
        this.value = new Ast.Value.VarRef(`__const_${escapedSymbol}_${number}`);
        // HACK: VarRefs don't know their own types normally, but these ones do
        this.value.getType = () => type;
        this.value.constNumber = number;
    }

    toString() {
        return `${this.symbol}_${this.number}`;
    }
}

class Placeholder {
    constructor(symbol, option) {
        this.symbol = symbol;
        this.option = option;
        assert(!option || option === 'const' || option === 'no-undefined');
    }

    toString() {
        return '${' + this.symbol + '}';
    }
}

class Context {
    constructor(code, value, entities) {
        this.code = code;
        this.value = value;
        this.entities = entities;

        this.constants = {};
        for (let token of code) {
            if (/^[A-Z]/.test(token)) {
                let match = /^(.+)_([0-9]+)$/.exec(token);
                assert(match !== null);
                let type = match[1];
                let number = parseInt(match[2]);
                if (this.constants[type])
                    this.constants[type] = Math.max(this.constants[type], number + 1);
                else
                    this.constants[type] = number + 1;
            }
        }
    }

    toString() {
        return `CTX[${this.code.join(' ')}]`;
    }
}

function contextCompatible(c1, c2) {
    return c1 === null || c2 === null || c1 === c2;
}
function meetContext(c1, c2) {
    if (c1 === null)
        return c2;
    else
        return c1;
}

// A Derivation represents a sentence, possibly with placeholders,
// and a value, possibly with unspecified input parameters, that
// was computed at a certain point in the derivation tree
class Derivation {
    constructor(value, sentence, context = null) {
        this.value = value;
        if (value === undefined)
            throw new TypeError('Invalid value');
        this.context = context;
        this.sentence = sentence;
        if (!Array.isArray(sentence) || sentence.some((x) => x instanceof Derivation))
            throw new TypeError('Invalid sentence');

        this._flatSentence = null;
        this._hasPlaceholders = undefined;
    }

    hasPlaceholders() {
        if (this._hasPlaceholders !== undefined)
            return this._hasPlaceholders;

        for (let child of this.sentence) {
            if (child instanceof Placeholder)
                return this._hasPlaceholders = true;
        }
        return this._hasPlaceholders = false;
    }

    hasPlaceholder(what) {
        for (let child of this.sentence) {
            if (child instanceof Placeholder && child.symbol === what)
                return true;
        }
        return false;
    }

    get complete() {
        return !this.hasPlaceholders();
    }

    toString() {
        if (this._flatSentence)
            return this._flatSentence;

        return this._flatSentence = this.sentence.map((x) => String(x)).join(' ');
    }

    clone() {
        let value = this.value;
        let sentence = Array.from(this.sentence);
        let context = this.context;
        return new Derivation(value, sentence, context);
    }

    replacePlaceholder(name, derivation, semanticAction, { isConstant, isUndefined = false, throwIfMissing = false, allowEmptyPictureURL = false }) {
        let newValue;
        let isDerivation;
        if (!(derivation instanceof Derivation)) {
            newValue = semanticAction(this.value);
            isDerivation = false;
        } else {
            if (!contextCompatible(this.context, derivation.context))
                return null;
            newValue = semanticAction(this.value, derivation.value);
            isDerivation = true;
        }

        if (newValue === null) {
            /*if (!derivation.value.isVarRef || !derivation.value.name.startsWith('__const'))
                return null;*/
            /*if (throwIfMissing && this.hasPlaceholder(name)) {
                console.log('replace ' + name + ' in ' + this + ' with ' + derivation);
                console.log('values: ' + [this.value, derivation.value].join(' , '));
                throw new TypeError('???');
            }*/
            return null;
        }
        let newSentence = [];
        let newContext = this.context;
        let found = false;
        for (let child of this.sentence) {
            if (child instanceof Placeholder) {
                if (child.symbol === name) {
                    if (child.option === 'no-undefined' && isUndefined)
                        return null;
                    if (child.option === 'const' && !isConstant && !isUndefined)
                        return null;
                    if (isDerivation) {
                        newSentence.push(...derivation.sentence);
                        newContext = meetContext(newContext, derivation.context);
                    } else {
                        newSentence.push(derivation);
                    }
                    found = true;
                } else if (!found) {
                    // refuse to leave a placeholder empty in the middle
                    // this prevents creating duplicates

                    // HACK HACK HACK: unless the hole is "p_picture_url",
                    // because otherwise we will never fill both
                    // p_picture_url and p_caption
                    if (allowEmptyPictureURL && child.symbol === 'p_picture_url')
                        newSentence.push(child);
                    else
                        return null;
                } else {
                    newSentence.push(child);
                }
            } else {
                newSentence.push(child);
            }
        }
        if (!found) {
            /*if (name === 'p_picture_url')
                console.log('no placeholder ' + name + ', have ' + String(this.sentence));
            if (throwIfMissing)
                throw new TypeError('???');*/
            return null;
        }

        return new Derivation(newValue, newSentence, newContext);
    }

    static combine(children, semanticAction) {
        if (children.length === 1) {
            assert(!(children[0] instanceof Context));
            if (children[0] instanceof Derivation) {
                let clone = children[0].clone();
                clone.value = semanticAction(children[0].value);
                if (clone.value === null)
                    return null;
                return clone;
            } else if (children[0] instanceof Placeholder) {
                let value = semanticAction();
                if (value === null)
                    return null;
                return new Derivation(value, children);
            } else { // constant or terminal
                let value = semanticAction();
                if (value === null)
                    return null;
                return new Derivation(value, children);
            }
        }

        let sentence = [];
        let values = [];
        let newContext = null;

        for (let child of children) {
            // does not go into the input sentence
            if (child instanceof Context) {
                newContext = child;
                values.push(child.value);
                continue;
            }

            if (typeof child === 'string' || child instanceof Constant || child instanceof Placeholder) { // terminal
                sentence.push(child);
            } else if (child instanceof Derivation) {
                if (!contextCompatible(newContext, child.context))
                    return null;
                newContext = meetContext(newContext, child.context);
                values.push(child.value);
                sentence.push(...child.sentence);
            }
        }

        //console.log('combine: ' + children.join(' ++ '));
        //console.log('values: ' + values.join(' , '));

        let value = semanticAction(...values);
        if (!value)
            return null;
        return new Derivation(value, sentence, newContext);
    }
}

module.exports = {
    Constant,
    Context,
    Placeholder,
    Derivation
};
