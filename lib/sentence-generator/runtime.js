// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const List = require('./list');
const { uniform } = require('../utils/random');

const LogLevel = {
    NONE: 0,

    // log at the beginning and at the end of the generation for each depth, and notable events
    // such as particularly slow templates
    INFO: 1,

    // log each non-empty non terminal
    GENERATION: 2,

    // log all templates before generation
    DUMP_TEMPLATES: 3,

    // log information derived from the templates (such as the distance from the root)
    DUMP_DERIVED: 4,

    // log a lot of very redundant information during generation (can cause slowdowns)
    EVERYTHING: 5
};

// A numbered constant, eg. QUOTED_STRING_0 or NUMBER_1 or HASHTAG_3
// During generation, this constant is put in the program as a VarRef
// with an unique variable name.
class Constant {
    constructor(symbol, number, value) {
        this.symbol = symbol;
        this.number = number;
        this.value = value;
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
        return '${' + this.symbol + '}'; //'
    }
}

/**
 * A reference to a context.
 *
 * A context is an object that is passed as extra input to a semantic function
 * to affect its behavior. Grammar rules are only applied between identical (===) contexts.
 *
 * The "context" in this definition roughly corresponds to a dialogue context
 * (either a C: state, or a more general notion) but it need not be.
 *
 * "priv" is a value associated with the context that is only meaningful to the API caller
 * (DialogueGenerator). "info" is a value associated with the context that is meaningful
 * to the semantic function.
 * See {@link Grammar#_initializeContexts} for a longer explanation.
 */
class Context {
    constructor(priv, info) {
        this.priv = priv;
        this.info = info;
    }

    toString() {
        return `CTX[${this.info}]`;
    }

    static compatible(c1, c2) {
        return c1 === null || c2 === null || c1 === c2;
    }
    static meet(c1, c2) {
        if (c1 === null)
            return c2;
        else
            return c1;
    }
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
        assert(sentence instanceof List);

        this._flatSentence = null;
        this._hasPlaceholders = undefined;
    }

    hasPlaceholders() {
        if (this._hasPlaceholders !== undefined)
            return this._hasPlaceholders;

        let hasPlaceholders = false;
        this.sentence.traverse((child) => {
            hasPlaceholders = hasPlaceholders || child instanceof Placeholder;
        });
        return this._hasPlaceholders = hasPlaceholders;
    }

    hasPlaceholder(what) {
        let hasPlaceholder = false;
        this.sentence.traverse((child) => {
            hasPlaceholder = hasPlaceholder || (child instanceof Placeholder && child.symbol === what);
        });
        return hasPlaceholder;
    }

    get complete() {
        let v = !this.hasPlaceholders();
        return v;
    }

    toString() {
        if (this._flatSentence)
            return this._flatSentence;

        const flattened = [];
        this.sentence.traverse((el) => flattened.push(String(el)));
        return this._flatSentence = flattened.join(' ');
    }

    clone() {
        let value = this.value;
        let sentence = this.sentence;
        let context = this.context;
        return new Derivation(value, sentence, context);
    }

    replacePlaceholder(name, replacement, semanticAction, { isConstant, isUndefined = false, throwIfMissing = false }) {
        let newValue;
        let isDerivation;
        if (!(replacement instanceof Derivation)) {
            newValue = semanticAction(this.value);
            isDerivation = false;
        } else {
            assert(Context.compatible(this.context, replacement.context));
            newValue = semanticAction(this.value, replacement.value);
            isDerivation = true;
        }
        assert(newValue !== undefined);

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

        let newSentence = List.Nil;
        let newContext = this.context;
        let found = false;
        let bad = false;
        this.sentence.traverse((child) => {
            if (child instanceof Placeholder && child.symbol === name) {
                if (child.option === 'no-undefined' && isUndefined)
                    bad = true;
                if (child.option === 'const' && !isConstant && !isUndefined)
                    bad = true;
                if (isDerivation) {
                    newSentence = List.concat(newSentence, replacement.sentence);
                    newContext = Context.meet(newContext, replacement.context);
                } else {
                    newSentence = List.append(newSentence, replacement);
                }
                found = true;
            } else {
                newSentence = List.append(newSentence, child);
            }
        });

        if (!found || bad) {
            /*if (name === 'p_picture_url')
                console.log('no placeholder ' + name + ', have ' + String(this.sentence));
            if (throwIfMissing)
                throw new TypeError('???');
            */
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
                return new Derivation(value, List.singleton(children[0]));
            } else { // constant or terminal
                let value = semanticAction();
                if (value === null)
                    return null;
                return new Derivation(value, List.singleton(children[0]));
            }
        }

        let sentence = List.Nil;
        let values = [];
        let newContext = null;

        for (let child of children) {
            // does not go into the input sentence
            if (child instanceof Context) {
                newContext = child;
                values.push(child.info);
                continue;
            }

            if (typeof child === 'string' || child instanceof Constant || child instanceof Placeholder) { // terminal
                sentence = List.append(sentence, child);
            } else if (child instanceof Derivation) {
                assert(Context.compatible(newContext, child.context));
                newContext = Context.meet(newContext, child.context);
                values.push(child.value);
                sentence = List.concat(sentence, child.sentence);
            }
        }

        //console.log('combine: ' + children.join(' ++ '));
        //console.log('values: ' + values.join(' , '));

        let value = semanticAction(...values);
        assert(value !== undefined);
        if (value === null)
            return null;
        return new Derivation(value, sentence, newContext);
    }
}


// Combination operators: use to create a semantic function that, given two child derivations,
// produces a new derivation

function simpleCombine(semanticAction, flag, topLevel = false) {
    return function(children) {

        const result = Derivation.combine(children, semanticAction);
        if (result === null)
            return null;
        if (flag) {
            if (flag.startsWith('!')) {
                if (result[flag.substring(1)])
                    return null;
            } else {
                if (!result[flag])
                    return null;
            }
        }
        if (!result.hasPlaceholders())
            return checkConstants(result, topLevel);
        else
            return result;
    };
}

function combineReplacePlaceholder(pname, semanticAction, options) {
    let f= function([c1, c2]) {
        return c1.replacePlaceholder(pname, c2, semanticAction, options);
    };
    f.isReplacePlaceholder = true;
    return f;
}

function checkConstants(result, topLevel) {
    let constants = {};
    let bad = false;
    result.sentence.traverse((piece) => {
        if (!(piece instanceof Constant))
            return;
        if (piece.symbol in constants) {
            if (piece.number !== constants[piece.symbol] + 1) {
                bad = true;
                return;
            }
        } else {
            if (topLevel) {
                let min = 0;
                if (piece.number !== min) {
                    bad = true;
                    return;
                }
            }
        }
        constants[piece.symbol] = piece.number;
    });
    if (bad)
        return null;
    return result;
}

class NonTerminal {
    constructor(symbol) {
        this.symbol = symbol;
        this.index = -1;
    }

    toString() {
        return `NT[${this.symbol}]`;
    }
}

class Choice {
    constructor(choices) {
        this.choices = choices;
    }

    choose(rng) {
        return uniform(this.choices, rng);
    }

    toString() {
        return `C[${this.choices.join('|')}]`;
    }
}

//const everything = new Set;

module.exports = {
    LogLevel,

    Constant,
    Placeholder,
    Derivation,
    Context,
    NonTerminal,
    Choice,

    simpleCombine,
    combineReplacePlaceholder
};
