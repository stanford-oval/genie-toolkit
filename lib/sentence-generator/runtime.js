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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const { coin, uniform } = require('../random');

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
    }

    toString() {
        return '${' + this.symbol + '}';
    }
}

// A Derivation represents a sentence, possibly with placeholders,
// and a value, possibly with unspecified input parameters, that
// was computed at a certain point in the derivation tree
class Derivation {
    constructor(value, sentence) {
        this.value = value;
        if (value === undefined)
            throw new TypeError('Invalid value');
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
        return new Derivation(value, sentence);
    }

    replacePlaceholder(name, derivation, semanticAction, { isConstant, throwIfMissing = false, allowEmptyPictureURL = false }) {
        let newValue;
        let isDerivation;
        if (!(derivation instanceof Derivation)) {
            newValue = semanticAction(this.value);
            isDerivation = false;
        } else {
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
        let found = false;
        for (let child of this.sentence) {
            if (child instanceof Placeholder) {
                if (child.symbol === name) {
                    if (child.option === 'const' && !isConstant)
                        return null;
                    if (isDerivation)
                        newSentence.push(...derivation.sentence);
                    else
                        newSentence.push(derivation);
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

        return new Derivation(newValue, newSentence);
    }

    static combine(children, semanticAction) {
        if (children.length === 1) {
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
        for (let child of children) {
            if (typeof child === 'string' || child instanceof Constant || child instanceof Placeholder) { // terminal
                sentence.push(child);
            } else if (child instanceof Derivation) {
                values.push(child.value);
                sentence.push(...child.sentence);
            }
        }

        //console.log('combine: ' + children.join(' ++ '));
        //console.log('values: ' + values.join(' , '));

        let value = semanticAction(...values);
        if (!value)
            return null;
        return new Derivation(value, sentence);
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
    for (let piece of result.sentence) {
        if (!(piece instanceof Constant))
            continue;
        if (piece.symbol in constants) {
            if (piece.number !== constants[piece.symbol] + 1)
                return null;
        } else {
            if (topLevel && piece.number !== 0)
                return null;
        }
        constants[piece.symbol] = piece.number;
    }

    return result;
}

class NonTerminal {
    constructor(symbol) {
        this.symbol = symbol;
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

const POWERS = [1, 1, 1, 1, 1];
for (let i = 5; i < 20; i++)
    POWERS[i] = 0.5 * POWERS[i-1];
const TARGET_GEN_SIZE = 100000;

// the maximum number of distinct constants of a certain type in a program
const DEFAULT_MAX_CONSTANTS = 5;

class Grammar {
    constructor(options) {
        this._options = options || {};
        this._rules = {
            $root: []
        };

        this._finalized = false;
        this._averagePruningFactor = {};
        this._minDistanceFromRoot = {};
    }

    hasSymbol(symbol) {
        return this._rules.hasOwnProperty(symbol);
    }

    declareSymbol(symbol) {
        if (!this._rules[symbol])
            this._rules[symbol] = [];
    }

    addConstants(symbol, token, type) {
        if (this._finalized)
            throw new Error(`Grammar was finalized, cannot add more rules`);
        for (let i = 0; i < (this._options.maxConstants || DEFAULT_MAX_CONSTANTS); i++) {
            let constant = new Constant(token, i, type);
            this._rules[symbol].push([[constant], () => new Derivation(constant.value, [constant])]);
        }
    }

    addRule(symbol, expansion, combiner) {
        if (this._finalized)
            throw new Error(`Grammar was finalized, cannot add more rules`);
        this._rules[symbol].push([expansion, combiner]);
    }

    _typecheck() {
        for (let category in this._rules) {
            for (let rule of this._rules[category]) {
                for (let expansion of rule[0]) {
                    if (expansion instanceof NonTerminal) {
                        if (!this._rules[expansion.symbol])
                            throw new Error(`Non terminal ${expansion.symbol} undefined, referenced by ${category}`);
                    }
                }
            }
        }
    }

    _computeDistanceFromRoot() {
        let queue = [];
        this._minDistanceFromRoot.$root = 0;
        queue.push(['$root', 0]);

        while (queue.length > 0) {
            let [category, distance] = queue.shift();
            if (distance > this._minDistanceFromRoot[category])
                continue;

            for (let rule of this._rules[category]) {
                for (let expansion of rule[0]) {
                    if (expansion instanceof NonTerminal) {
                        let existingDistance = this._minDistanceFromRoot[expansion.symbol];
                        if (!(distance+1 >= existingDistance)) { // undefined/NaN-safe comparison
                            this._minDistanceFromRoot[expansion.symbol] = distance+1;
                            queue.push([expansion.symbol, distance+1]);
                        }
                    }
                }
            }
        }

        if (this._options.debug) {
            for (let category in this._rules) {
                if (this._minDistanceFromRoot[category] === undefined) {
                    // this happens with autogenerated projection non-terminals of weird types
                    // that cannot be parameter passed
                    console.log(`nonterm NT[${category}] -> not reachable from root`);
                } else {
                    console.log(`nonterm NT[${category}] -> ${this._minDistanceFromRoot[category]} steps from root`);
                }
            }
        }
    }

    finalize() {
        if (this._finalized)
            return;
        this._typecheck();

        for (let category in this._rules) {
            let prunefactors = [];
            this._averagePruningFactor[category] = prunefactors;

            for (let rule of this._rules[category]) {
                // initialize prune factor estimates to 0.2
                // so we don't start pruning until we have a good estimate
                prunefactors.push(0.2);

                let [expansion, ] = rule;

                if (this._options.debug)
                    console.log(`rule NT[${category}] -> ${expansion.join(' ')}`);
            }
        }

        this._computeDistanceFromRoot();
    }

    *generate() {
        this.finalize();

        const charts = [];

        for (let i = 0; i <= this._options.maxDepth; i++) {
            if (this._options.debug)
                console.log(`--- DEPTH ${i}`);
            charts[i] = {};
            for (let nonterminal in this._rules)
                charts[i][nonterminal] = [];

            for (let nonterminal in this._rules) {
                const minDistance = this._minDistanceFromRoot[nonterminal];
                if (minDistance === undefined || minDistance > this._options.maxDepth - i)
                    continue;
                let j = 0;
                for (let rule of this._rules[nonterminal]) {
                    for (let derivation of expandRule(charts, i, nonterminal, j, rule, this._averagePruningFactor, this._options)) {
                        if (derivation === null)
                            continue;
                        //let key = `$${nonterminal} -> ${derivation}`;
                        /*if (everything.has(key)) {
                            // FIXME we should not generate duplicates in the first place
                            throw new Error('generated duplicate: ' + key);
                            continue;
                        }*/
                        //everything.add(key);
                        charts[i][nonterminal].push(derivation);
                    }
                    j++;
                }
                if (this._options.debug && charts[i][nonterminal].length > 0)
                    console.log(`stats: size(charts[${i}][${nonterminal}]) = ${charts[i][nonterminal].length}`);
            }

            for (let root of charts[i].$root)
                yield [i,root];
            charts[i].$root = [];
            if (this._options.debug)
                console.log();
        }
    }
}


function *expandRule(charts, depth, nonterminal, rulenumber, [expansion, combiner], averagePruningFactor, options) {
    const rng = options.rng;

    const anyNonTerm = expansion.some((x) => x instanceof NonTerminal);

    if (!anyNonTerm) {
        if (depth === 0)
            yield combiner(expansion);
        return;
    }
    if (depth === 0)
        return;

    // for each piece of the expansion, we take turn and use
    // depth-1 of that, depth' < depth-1 of anything before, and
    // depth' <= depth-1 of anything after
    // terminals and placeholders are treated as having only
    // 0 productions
    //
    // this means the order in which we generate is
    // (d-1, 0, 0, ..., 0)
    // (d-1, 0, 0, ..., 1)
    // ...
    // (d-1, 0, 0, ..., d-1)
    // (d-1, 0, 0, ..., 1, 0)
    // ...
    // (d-1, 0, 0, ..., 1, d-1)
    // (d-1, 0, 0, ..., 2, 0)
    // ...
    // (d-1, 0, 0, ..., d-1, d-1)
    // ...
    // (d-1, d-1, d-1, ..., d-1)
    // (0, d-1, 0, ..., 0)
    // (0, d-1, 0, ..., 1)
    // ...
    // (0, d-1, 0, ..., d-1)
    // ...
    // (0, d-1, d-1, ..., d-1)
    // (1, d-1, 0, ..., 0)
    // ...
    // (1, d-1, d-1, ..., d-1)
    // ...
    // (d-2, d-1, 0, ..., 0)
    // ...
    // (d-2, d-1, d-1, ..., d-1)
    // ...
    // (d-2, 0, d-1, 0, ..., 0)
    // ...
    // (d-2, d-2, d-1, d-1, ..., d-1)
    // ...
    // (0, 0, ..., 0, d-1)
    // (0, 0, ..., 1, d-1)
    // ...
    // (0, 0, ..., d-2, d-1)
    // ...
    // (d-2, d-2, ..., d-2, d-1)
    //
    // This is a SUPEREXPONENTIAL algorithm
    // Keep the depth low if you want to live

    //console.log('expand $' + nonterminal + ' -> ' + expansion.join(''));

    // to avoid hitting exponential behavior too often, we tweak the above
    // algorithm to not go above maxdepth for all but one non-terminal,
    // and then cycle through which non-terminal is allowed to grow
    function computeWorstCaseGenSize(maxdepth) {
        let worstCaseGenSize = 0;
        for (let i = 0; i < expansion.length; i++) {
            let fixeddepth = depth-1;
            worstCaseGenSize += (function recursiveHelper(k) {
                if (k === expansion.length)
                    return 1;
                if (k === i) {
                    if (expansion[k] instanceof NonTerminal)
                        return charts[fixeddepth][expansion[k].symbol].length * recursiveHelper(k+1);
                    else
                        return 0;
                }
                if (expansion[k] instanceof NonTerminal) {
                    let sum = 0;
                    for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++)
                        sum += charts[j][expansion[k].symbol].length * recursiveHelper(k+1);
                    return sum;
                } else {
                    return recursiveHelper(k+1);
                }
            })(0);
        }
        return worstCaseGenSize;
    }


    // first compute how many things we expect to produce in the worst case
    let maxdepth = depth-1;
    let worstCaseGenSize = computeWorstCaseGenSize(maxdepth);
    if (worstCaseGenSize === 0)
        return;

    // prevent exponential behavior!
    while (worstCaseGenSize >= 10000000 && maxdepth >= 0) {
        if (options.debug)
            console.log(`expand NT[${nonterminal}] -> ${expansion.join(' ')} : worst case ${worstCaseGenSize}, reducing max depth`);
        maxdepth--;
        worstCaseGenSize = computeWorstCaseGenSize(maxdepth);
    }
    if (maxdepth < 0 || worstCaseGenSize === 0)
        return;

    const estimatedPruneFactor = averagePruningFactor[nonterminal][rulenumber];
    const estimatedGenSize = worstCaseGenSize * estimatedPruneFactor;
    //const targetGenSize = nonterminal === 'root' ? Infinity : TARGET_GEN_SIZE * POWERS[depth];
    const targetGenSize = TARGET_GEN_SIZE * POWERS[depth];

    if (options.debug)
        console.log(`expand NT[${nonterminal}] -> ${expansion.join(' ')} : worst case ${worstCaseGenSize}, expect ${Math.round(estimatedGenSize)} (target ${targetGenSize})`);
    const now = Date.now();

    let coinProbability = Math.min(1, targetGenSize/estimatedGenSize);

    let choices = [];
    //let depths = [];
    let actualGenSize = 0;
    let prunedGenSize = 0;
    for (let i = 0; i < expansion.length; i++) {
        let fixeddepth = depth-1;
        yield* (function *recursiveHelper(k) {
            if (k === expansion.length) {
                //console.log('combine: ' + choices.join(' ++ '));
                //console.log('depths: ' + depths);
                if (!(coinProbability < 1) || coin(coinProbability, rng)) {
                    let v = combiner(choices.map((c) => c instanceof Choice ? c.choose(rng) : c));
                    if (v !== null) {
                        actualGenSize ++;
                        if (actualGenSize + prunedGenSize >= 1000 && actualGenSize / (actualGenSize + prunedGenSize) < 0.001 * estimatedPruneFactor) {
                            // this combiner is pruning so aggressively it's messing up our sampling
                            // disable it
                            coinProbability = 1;
                        }

                        yield v;
                    } else {
                        prunedGenSize ++;
                    }
                }
                return;
            }
            if (k === i) {
                if (expansion[k] instanceof NonTerminal) {
                    for (let candidate of charts[fixeddepth][expansion[k].symbol]) {
                        if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                            continue;
                        choices[k] = candidate;
                        //depths[k] = fixeddepth;
                        yield* recursiveHelper(k+1);
                    }
                }
                return;
            }
            if (expansion[k] instanceof NonTerminal) {
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++) {
                    for (let candidate of charts[j][expansion[k].symbol]) {
                        if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                            continue;
                        choices[k] = candidate;
                        //depths[k] = j;
                        yield* recursiveHelper(k+1);
                    }
                }
            } else {
                choices[k] = expansion[k];
                yield* recursiveHelper(k+1);
            }
        })(0);
    }

    //console.log('expand $' + nonterminal + ' -> ' + expansion.join('') + ' : actual ' + actualGenSize);

    if (actualGenSize + prunedGenSize === 0)
        return;
    const newEstimatedPruneFactor = actualGenSize / (actualGenSize + prunedGenSize);

    const elapsed = Date.now() - now;
    if (options.debug) {
        console.log(`expand NT[${nonterminal}] -> ${expansion.join(' ')} : emitted ${
            actualGenSize} (took ${(elapsed/1000).toFixed(2)} seconds, coin prob ${coinProbability}, pruning factor ${
                (newEstimatedPruneFactor * 100).toFixed(2)}%)`);
    }

    const movingAverageOfPruneFactor = (0.01 * estimatedPruneFactor + newEstimatedPruneFactor) / (1.01);
    averagePruningFactor[nonterminal][rulenumber] = movingAverageOfPruneFactor;
}

//const everything = new Set;

module.exports = {
    Constant,
    Placeholder,
    Derivation,

    Grammar,
    NonTerminal,
    Choice,

    simpleCombine,
    combineReplacePlaceholder
};
