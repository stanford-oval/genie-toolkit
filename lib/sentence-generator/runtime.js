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
const events = require('events');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const { ReservoirSampler, coin, uniform } = require('../random');

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
        return '${' + this.symbol + '}'; //'
    }
}

class Context {
    constructor(dlg, info) {
        this.dlg = dlg;
        this.constants = dlg.constants;
        this.value = dlg.context;
        this.info = info;
    }

    toString() {
        return `CTX[${this.value.prettyprint()}]`;
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
                values.push(child.info);
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
        return result;
        /*if (!result.hasPlaceholders())
            return checkConstants(result, topLevel);
        else
            return result;
        */
    };
}

function combineReplacePlaceholder(pname, semanticAction, options) {
    let f= function([c1, c2]) {
        return c1.replacePlaceholder(pname, c2, semanticAction, options);
    };
    f.isReplacePlaceholder = true;
    return f;
}

/*
function checkConstants(result, topLevel) {
    let constants = {};
    for (let piece of result.sentence) {
        if (!(piece instanceof Constant))
            continue;
        if (piece.symbol in constants) {
            if (piece.number !== constants[piece.symbol] + 1)
                return null;
        } else {
            if (topLevel) {
                let min = 0;
                if (result.context !== null)
                    min = result.context.constants[piece.symbol] || 0;
                else
                    min = 0;
                if (piece.number !== min)
                    return null;
            }
        }
        constants[piece.symbol] = piece.number;
    }

    return result;
}
*/

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

class Rule {
    constructor(number, expansion, combiner, weight = 1, repeat = false) {
        this.number = number;
        this.expansion = expansion;
        this.combiner = combiner;
        this.weight = weight;
        this.repeat = repeat;
        assert(this.weight > 0);
    }
}

// the maximum number of distinct constants of a certain type in a program
const DEFAULT_MAX_CONSTANTS = 5;

class GenieTypeError extends Error {
}

// heuristically collected coefficients of the duration of generating each depth
const DEPTH_PROGRESS_MULTIPLIERS = [
    50, 1500, 21000, 1350000, 750000, 400000, 3000000, 3000000, 3000000, 3000000, 3000000
];

class Grammar extends events.EventEmitter {
    constructor(options) {
        super();

        this._options = options || {};
        this._contextual = options.contextual;

        this._nonTermTable = new Map;
        this._nonTermList = [];
        this._rules = [];

        this._contextTable = new Map;
        this._contextTagger = null;

        this._rootIndex = this._internalDeclareSymbol('$root');
        assert(this._rootIndex === 0);

        this._finalized = false;
        this._averagePruningFactor = [];
        this._minDistanceFromRoot = [];

        this._progress = 0;
    }

    get progress() {
        return this._progress;
    }

    hasSymbol(symbol) {
        return this._nonTermTable.has(symbol);
    }

    hasContext(symbol) {
        return this._contextTable.has(symbol);
    }

    _internalDeclareSymbol(symbol) {
        const index = this._nonTermList.length;
        this._nonTermList.push(symbol);
        this._rules.push([]);
        assert(this._rules.length === this._nonTermList.length);
        this._nonTermTable.set(symbol, index);
        return index;
    }

    setContextTagger(fn) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot set context tagger`);
        if (!this._contextual)
            throw new GenieTypeError(`Grammar is not contextual, cannot set context tagger`);
        if (this._contextTagger !== null)
            throw new GenieTypeError(`Context tagger already set`);
        this._contextTagger = fn;
    }

    declareContext(context, fn) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot declare more contexts`);
        if (!this._contextual)
            throw new GenieTypeError(`Grammar is not contextual, cannot include context statements`);
        if (this.hasContext(context))
            throw new GenieTypeError(`Context ${context} has already been declared`);
        if (this.hasSymbol(context))
            throw new GenieTypeError(`Identifier ${context} cannot be both a context and a non-terminal`);

        // declare also as a non-terminal
        const index = this._internalDeclareSymbol(context);
        this._contextTable.set(context, index);
    }

    declareSymbol(symbol) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, declare more non-terminals`);
        if (this.hasContext(symbol))
            throw new GenieTypeError(`Identifier ${symbol} cannot be both a context and a non-terminal`);
        if (this.hasSymbol(symbol))
            return;

        this._internalDeclareSymbol(symbol);
    }

    _lookupNonTerminal(symbol) {
        const index = this._nonTermTable.get(symbol);
        if (index === undefined)
            throw new GenieTypeError(`Identifier ${symbol} is not a non-terminal`);
        return index;
    }

    _addRuleInternal(symbolId, expansion, combiner, attributes = {}) {
        const rulenumber = this._rules[symbolId].length;
        this._rules[symbolId].push(new Rule(rulenumber, expansion, combiner, attributes.weight, attributes.repeat));
    }

    addConstants(symbol, token, type, attributes) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);

        const symbolId = this._lookupNonTerminal(symbol);
        for (let i = 0; i < (this._options.maxConstants || DEFAULT_MAX_CONSTANTS); i++) {
            let constant = new Constant(token, i, type);
            this._addRuleInternal(symbolId, [constant], (() => new Derivation(constant.value, [constant])), attributes);
        }
    }

    addRule(symbol, expansion, combiner, attributes) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);
        this._addRuleInternal(this._lookupNonTerminal(symbol), expansion, combiner, attributes);
    }

    _typecheck() {
        if (this._contextual && !this._contextTagger)
            throw new GenieTypeError(`Missing context tagger function for contextual grammar`);

        for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++) {
            const nonTerm = this._nonTermList[nonTermIndex];
            const rules = this._rules[nonTermIndex];

            for (let rule of rules) {
                let first = true;
                let hasContext = false;

                for (let expansion of rule.expansion) {
                    if (expansion instanceof NonTerminal) {
                        if (this.hasContext(expansion.symbol)) {
                            if (!first)
                                throw new GenieTypeError(`Context symbol ${expansion.symbol} must be first in expansion of ${nonTerm}`);
                            hasContext = true;
                            first = false;
                            expansion.index = this._nonTermTable.get(expansion.symbol);
                            continue;
                        }

                        const index = this._nonTermTable.get(expansion.symbol);
                        if (index === undefined)
                            throw new Error(`Non-terminal ${expansion.symbol} undefined, referenced by ${nonTerm}`);
                        expansion.index = index;
                    }

                    first = false;
                }

                if (hasContext && rule.expansion.length === 1)
                    throw new GenieTypeError(`Rule with context must have an additional component in expansion of ${nonTerm}`);
            }
        }
    }

    _computeDistanceFromRoot() {
        // fill the array so it dense
        for (let i = 0; i < this._nonTermList.length; i++)
            this._minDistanceFromRoot.push(1<<29); // integer infinity
        assert(this._nonTermList.length === this._minDistanceFromRoot.length);

        let queue = [];
        for (let { index } of this._contextTable.values())
            this._minDistanceFromRoot[index] = 0;
        this._minDistanceFromRoot[this._rootIndex] = 0;
        queue.push([this._rootIndex, 0]);

        while (queue.length > 0) {
            let [index, distance] = queue.shift();
            if (distance > this._minDistanceFromRoot[index])
                continue;

            for (let rule of this._rules[index]) {
                for (let expansion of rule.expansion) {
                    if (expansion instanceof NonTerminal) {
                        assert(expansion.index !== undefined);
                        let existingDistance = this._minDistanceFromRoot[expansion.index];
                        if (!(distance+1 >= existingDistance)) { // undefined/NaN-safe comparison
                            this._minDistanceFromRoot[expansion.index] = distance+1;
                            queue.push([expansion.index, distance+1]);
                        }
                    }
                }
            }
        }

        if (this._options.debug) {
            for (let index = 0; index < this._nonTermList.length; index++) {
                if (this._minDistanceFromRoot[index] === undefined ||
                    this._minDistanceFromRoot[index] === 1<<29) {
                    // this happens with autogenerated projection non-terminals of weird types
                    // that cannot be parameter passed
                    console.log(`nonterm NT[${this._nonTermList[index]}] -> not reachable from root`);
                } else {
                    console.log(`nonterm NT[${this._nonTermList[index]}] -> ${this._minDistanceFromRoot[index]} steps from root`);
                }
            }
        }
    }

    _addAutomaticRepeat() {
        for (let index = 0; index < this._nonTermList.length; index++) {
            let shouldSetRepeat = false;
            for (let rule of this._rules[index]) {
                if (rule.repeat || rule.weight !== 1) {
                    shouldSetRepeat = true;
                    break;
                }
            }

            if (shouldSetRepeat) {
                for (let rule of this._rules[index])
                    rule.repeat = true;
            }
        }
    }

    finalize() {
        if (this._finalized)
            return;
        this._finalized = true;
        this._typecheck();

        this._addAutomaticRepeat();

        for (let index = 0; index < this._nonTermList.length; index++) {
            let prunefactors = [];
            this._averagePruningFactor.push(prunefactors);

            for (let rule of this._rules[index]) {
                // initialize prune factor estimates to 0.2
                // so we don't start pruning until we have a good estimate
                prunefactors.push(0.2);

                if (this._options.debug)
                    console.log(`rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
            }
        }

        this._computeDistanceFromRoot();
    }

    _estimateDepthSize(charts, depth) {
        const ruleEstimates = {};
        let estimate = 0;
        for (let index = 0; index < this._nonTermList.length; index++) {
            const minDistance = this._minDistanceFromRoot[index];
            if (minDistance === undefined || minDistance > this._options.maxDepth - depth)
                continue;
            const rules = this._rules[index];

            const estimates = [];
            ruleEstimates[index] = estimates;
            estimates.length = rules.length;
            for (let rule of rules) {
                let [/*maxdepth*/, /*worstCaseGenSize*/, estimatedGenSize, targetPruningSize]
                    = estimateRuleSize(charts, depth, index, rule, this._averagePruningFactor, this._options);

                estimatedGenSize = Math.min(Math.round(estimatedGenSize), targetPruningSize);
                estimates[rule.number] = estimatedGenSize;
                estimate += estimatedGenSize;
            }
        }
        return [estimate, ruleEstimates];
    }

    _initializeContexts(partialDialogues, charts, depth) {
        for (let dlg of partialDialogues) {
            try {
                const result = this._contextTagger(dlg.context);
                if (result !== null) {
                    const [tags, info] = result;
                    const ctx = new Context(dlg, info);
                    for (let tag of tags) {
                        const index = this._contextTable.get(tag);
                        assert (index !== undefined, `Invalid context tag ${tag}`);
                        charts[depth][index].add(ctx);
                    }
                }
            } catch(e) {
                console.error(dlg);
                throw e;
            }
        }

        if (this._options.debug) {
            for (let index of this._contextTable.values()) {
                if (charts[depth][index].length > 0)
                    console.log(`stats: size(charts[${depth}][${this._nonTermList[index]}]) = ${charts[depth][index].length}`);
            }
        }
    }

    generate(contexts, callback) {
        this.finalize();
        const charts = [];

        // reset progress counter for this round (only if contextual)
        this._progress = 0;

        // compute the level of progress bar that should be reached at the end of each depth
        // using the heuristic coefficients, renormalized based on the chosen max depth
        const progressAtDepth = [DEPTH_PROGRESS_MULTIPLIERS[0]];
        for (let depth = 1; depth <= this._options.maxDepth; depth++)
            progressAtDepth.push(progressAtDepth[depth-1] + DEPTH_PROGRESS_MULTIPLIERS[depth]);
        for (let depth = 0; depth <= this._options.maxDepth; depth++)
            progressAtDepth[depth] /= progressAtDepth[progressAtDepth.length-1];

        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            if (this._options.debug)
                console.log(`--- DEPTH ${depth}`);
            const depthbegin = Date.now();

            const targetPruningSize = this._options.targetPruningSize * POWERS[depth];
            charts[depth] = [];
            for (let index = 0; index < this._nonTermList.length; index++)
                charts[depth].push(new ReservoirSampler(Math.ceil(targetPruningSize), this._options.rng));
            assert(charts[depth].length === this._nonTermList.length);

            if (this._contextual && depth === 0)
                this._initializeContexts(contexts, charts, depth);

            // compute estimates of how many things we will produce at this depth
            let [estimatedTotal, estimatedPerRule] = this._estimateDepthSize(charts, depth);
            let actual = 0;

            const targetProgress = progressAtDepth[depth];

            // subdivide the remaining progress among the (estimated) derivations we'll generate at this depth
            let progressIncrement;
            if (estimatedTotal >= 1)
                progressIncrement = (targetProgress - this._progress)/estimatedTotal;
            else
                progressIncrement = 0;

            for (let index = 0; index < this._nonTermList.length; index++) {
                const minDistance = this._minDistanceFromRoot[index];
                if (minDistance === undefined || minDistance > this._options.maxDepth - depth)
                    continue;
                const isRoot = index === this._rootIndex;

                let nonTermSize = 0;

                for (const rule of this._rules[index]) {

                    let ruleProductivity = 0;
                    let ruleTarget = Math.min(10 * Math.ceil(targetPruningSize * rule.weight), MAX_SAMPLE_SIZE);
                    let sampler = new ReservoirSampler(ruleTarget, this._options.rng);
                    try {
                        expandRule(charts, depth, index, rule, this._averagePruningFactor, this._options, this._nonTermList, (derivation) => {
                            if (derivation === null)
                                return;
                            //let key = `$${nonterminal} -> ${derivation}`;
                            /*if (everything.has(key)) {
                                // FIXME we should not generate duplicates in the first place
                                throw new Error('generated duplicate: ' + key);
                                continue;
                            }*/
                            //everything.add(key);
                            sampler.add(derivation);

                            this._progress += progressIncrement;
                            actual ++;
                            ruleProductivity++;

                            if (actual >= estimatedTotal || this._progress >= targetProgress)
                                progressIncrement = 0;
                            if (this._progress > targetProgress)
                                this._progress = targetProgress;
                            assert(this._progress >= 0 && this._progress <= 1);
                            if (actual % 5000 === 0)
                                this.emit('progress', this._progress);
                        });
                    } catch(e) {
                        console.error(`Error expanding rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
                        throw e;
                    }
                    // if this rule hasn't hit the target, duplicate all the outputs until we hit exactly the target
                    if (rule.repeat && sampler.length > 0 && sampler.length < ruleTarget) {
                        const lengthbefore = sampler.length;
                        sampler = Array.from(sampler);
                        const lengthafter = sampler.length;
                        assert(lengthbefore === lengthafter);
                        for (let i = sampler.length; i < ruleTarget; i++)
                            sampler.push(uniform(sampler, this._options.rng));
                    }

                    // adjust our estimated total size, based on what just happened with this rule
                    const ruleEstimate = estimatedPerRule[index][rule.number];
                    assert(ruleEstimate >= 0);

                    // subtract our old estimate, and add the real number of derivations we emitted
                    estimatedTotal -= ruleEstimate;
                    estimatedTotal += ruleProductivity;

                    // adjust the amount of progress we make on each sentence
                    // this ensures that the progress is monotonic, even though it will appear to
                    // move at different speeds

                    assert(estimatedTotal >= actual);
                    if (estimatedTotal === actual || this._progress >= targetProgress)
                        progressIncrement = 0;
                    else
                        progressIncrement = (targetProgress - this._progress) / (estimatedTotal - actual);
                    if (this._progress > targetProgress)
                        this._progress = targetProgress;
                    this.emit('progress', this._progress);

                    for (let derivation of sampler)
                        charts[depth][index].add(derivation);
                }
                nonTermSize = charts[depth][index].length;
                if (isRoot) {
                    for (let derivation of charts[depth][index])
                        callback(depth, derivation);
                    charts[depth][index].reset();
                }

                if (this._options.debug && nonTermSize > 0)
                    console.log(`stats: size(charts[${depth}][${this._nonTermList[index]}]) = ${nonTermSize}`);
            }

            if (this._options.debug) {
                console.log(`depth ${depth} took ${((Date.now() - depthbegin)/1000).toFixed(2)} seconds`);
                console.log();
            }

            this._progress = targetProgress;
        }

        // ensure that progress goes up to 1 at the end (to close the progress bar)

        this._progress = 1;
    }
}

const POWERS = [1, 1, 1, 1, 1];
for (let i = 5; i < 20; i++)
    POWERS[i] = 0.8 * POWERS[i-1];
const EXPONENTIAL_PRUNE_SIZE = 500000000;
const MAX_SAMPLE_SIZE = 1000000;

function computeWorstCaseGenSize(charts, depth, rule, maxdepth) {
    const expansion = rule.expansion;
    const anyNonTerm = expansion.some((x) => x instanceof NonTerminal);
    if (!anyNonTerm)
        return depth === 0 ? 1 : 0;
    if (depth === 0)
        return 0;

    let worstCaseGenSize = 0;
    for (let i = 0; i < expansion.length; i++) {
        let fixeddepth = depth-1;

        /*worstCaseGenSize += (function recursiveHelper(k) {
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
        })(0);*/

        // non-recursive version of the commented code above, tmp takes the role of "recursiveHelper(k+1)"
        let tmp = 1;

        for (let k = expansion.length - 1; k >= 0; k--) {
            if (k === i) {
                if (expansion[k] instanceof NonTerminal)
                    tmp = charts[fixeddepth][expansion[k].index].length * tmp;
                else
                    tmp = 0;
            } else if (expansion[k] instanceof NonTerminal) {
                let sum = 0;
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++)
                    sum += charts[j][expansion[k].index].length * tmp;
                tmp = sum;
            }
        }

        worstCaseGenSize += tmp;
    }
    return worstCaseGenSize;
}

function estimateRuleSize(charts, depth, nonTermIndex, rule, averagePruningFactor, options) {
    // first compute how many things we expect to produce in the worst case
    let maxdepth = depth-1;
    let worstCaseGenSize = computeWorstCaseGenSize(charts, depth, rule, maxdepth);
    if (worstCaseGenSize === 0)
        return [maxdepth, 0, 0, 0, 1];

    // prevent exponential behavior!
    while (worstCaseGenSize >= EXPONENTIAL_PRUNE_SIZE && maxdepth >= 0) {
        maxdepth--;
        worstCaseGenSize = computeWorstCaseGenSize(charts, depth, rule, maxdepth);
    }
    if (maxdepth < 0 || worstCaseGenSize === 0)
        return [maxdepth, 0, 0, 0, 1];

    const estimatedPruneFactor = averagePruningFactor[nonTermIndex][rule.number];
    const estimatedGenSize = worstCaseGenSize * estimatedPruneFactor;
    //const targetPruningSize = nonterminal === 'root' ? Infinity : TARGET_GEN_SIZE * POWERS[depth];
    const targetPruningSize = Math.floor(options.targetPruningSize * POWERS[depth] * rule.weight);

    return [maxdepth, worstCaseGenSize, estimatedGenSize, targetPruningSize, estimatedPruneFactor];
}

function expandRule(charts, depth, nonTermIndex, rule, averagePruningFactor, options, nonTermList, emit) {
    const rng = options.rng;

    const expansion = rule.expansion;
    const combiner = rule.combiner;
    const anyNonTerm = expansion.some((x) => x instanceof NonTerminal);

    if (!anyNonTerm) {
        if (depth === 0)
            emit(combiner(expansion));
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

    const [maxdepth, worstCaseGenSize, estimatedGenSize,, estimatedPruneFactor] =
        estimateRuleSize(charts, depth, nonTermIndex, rule, averagePruningFactor, options);

    if (maxdepth < depth-1 && options.debug)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : reduced max depth to avoid exponential behavior`);
    if (worstCaseGenSize === 0)
        return;

    if (options.debug)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : worst case ${worstCaseGenSize}, expect ${Math.round(estimatedGenSize)}`);

    //const now = Date.now();

    // to avoid spending too much time calling the combiner for things we'll prune later,
    // we randomly sample 1000000 out of all possible combinations
    const coinProbability = Math.min(1, MAX_SAMPLE_SIZE/worstCaseGenSize);

    let choices = [];
    //let depths = [];
    let actualGenSize = 0;
    let prunedGenSize = 0;
    for (let i = 0; i < expansion.length; i++) {
        let fixeddepth = depth-1;
        (function recursiveHelper(k) {
            if (k === expansion.length) {
                //console.log('combine: ' + choices.join(' ++ '));
                //console.log('depths: ' + depths);
                if (!(coinProbability < 1.0) || coin(coinProbability, rng)) {
                    let v = combiner(choices.map((c) => c instanceof Choice ? c.choose(rng) : c));
                    if (v !== null) {
                        actualGenSize ++;
                        emit(v);
                    } else {
                        prunedGenSize ++;
                    }
                }
                return;
            }
            if (k === i) {
                if (expansion[k] instanceof NonTerminal) {
                    for (let candidate of charts[fixeddepth][expansion[k].index]) {
                        if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                            continue;
                        choices[k] = candidate;
                        //depths[k] = fixeddepth;
                        recursiveHelper(k+1);
                    }
                }
                return;
            }
            if (expansion[k] instanceof NonTerminal) {
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++) {
                    for (let candidate of charts[j][expansion[k].index]) {
                        if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                            continue;
                        choices[k] = candidate;
                        //depths[k] = j;
                        recursiveHelper(k+1);
                    }
                }
            } else {
                choices[k] = expansion[k];
                recursiveHelper(k+1);
            }
        })(0);
    }

    //console.log('expand $' + nonterminal + ' -> ' + expansion.join('') + ' : actual ' + actualGenSize);

    if (actualGenSize + prunedGenSize === 0)
        return;
    const newEstimatedPruneFactor = actualGenSize / (actualGenSize + prunedGenSize);

    //const elapsed = Date.now() - now;
    /*if (options.debug) {
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : emitted ${
            actualGenSize} (took ${(elapsed/1000).toFixed(2)} seconds, pruning factor ${
                (newEstimatedPruneFactor * 100).toFixed(2)}%)`);
    }
    */

    const movingAverageOfPruneFactor = (0.01 * estimatedPruneFactor + newEstimatedPruneFactor) / (1.01);
    averagePruningFactor[nonTermIndex][rule.number] = movingAverageOfPruneFactor;
}

//const everything = new Set;

module.exports = {
    Constant,
    Placeholder,
    Derivation,
    Context,

    Grammar,
    NonTerminal,
    Choice,

    simpleCombine,
    combineReplacePlaceholder
};
