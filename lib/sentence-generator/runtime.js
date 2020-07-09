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

const List = require('./list');
const { ReservoirSampler, coin, uniform } = require('../utils/random');
const MultiMap = require('../utils/multimap');

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
            assert(contextCompatible(this.context, replacement.context));
            newValue = semanticAction(this.value, replacement.value);
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
                    newContext = meetContext(newContext, replacement.context);
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
                assert(contextCompatible(newContext, child.context));
                newContext = meetContext(newContext, child.context);
                values.push(child.value);
                sentence = List.concat(sentence, child.sentence);
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

class Rule {
    constructor(number, expansion, combiner, weight = 1, repeat = false, forConstant = false, temporary = false) {
        this.number = number;
        this.expansion = expansion;
        assert(this.expansion.length > 0);
        this.combiner = combiner;
        this.weight = weight;
        this.repeat = repeat;
        this.forConstant = forConstant;
        this.temporary = temporary;
        this.hasContext = false;
        this.enabled = true;
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

// in contextual (dialogue) generation, non-contextual non terminals have their pruning
// size multiplied by this factor
const NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER = 5;

class Grammar extends events.EventEmitter {
    constructor(targetLang, options) {
        super();

        this._target = targetLang;
        this._options = options || {};
        this._contextual = options.contextual;

        this._nonTermTable = new Map;
        this._nonTermList = [];
        this._rules = [];

        this._contextTable = new Map;
        this._functionTable = new Map;

        this._rootSymbol = options.rootSymbol || '$root';
        this._rootIndex = this._internalDeclareSymbol(this._rootSymbol);
        assert(this._rootIndex === 0);
        this._contextInitializer = options.contextInitializer;

        // map constant tokens (QUOTED_STRING, NUMBER, ...) to the non-terms where they are used (constant_String, ...)
        this._constantMap = new MultiMap;

        this._finalized = false;
        this._averagePruningFactor = [];
        this._minDistanceFromRoot = [];
        this._nonTermHasContext = [];

        this._charts = undefined;

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

    declareFunction(name, fn) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot declare more functions`);
        if (this._functionTable.has(name))
            throw new GenieTypeError(`Function ${name} already declared`);
        this._functionTable.set(name, fn);
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
        // ignore $user when loading the agent templates and vice-versa
        if (symbol.startsWith('$') && symbol !== this._rootSymbol)
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
        this._rules[symbolId].push(new Rule(rulenumber, expansion, combiner, attributes.weight, attributes.repeat, attributes.forConstant, attributes.temporary));
    }

    addConstants(symbol, token, type, attributes = {}) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);
        // ignore $user when loading the agent templates and vice-versa
        if (symbol.startsWith('$') && symbol !== this._rootSymbol)
            return;

        const symbolId = this._lookupNonTerminal(symbol);
        this._constantMap.put(token, symbolId);

        attributes.forConstant = true;
        for (let constant of this._target.createConstants(token, type, this._options.maxConstants || DEFAULT_MAX_CONSTANTS, this._contextual)) {
            const sentencepiece = constant instanceof Constant ? constant : constant.display;
            this._addRuleInternal(symbolId, [sentencepiece], (() => new Derivation(constant.value, List.singleton(sentencepiece))), attributes);
        }
    }

    addRule(symbol, expansion, combiner, attributes) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);
        // ignore $user when loading the agent templates and vice-versa
        if (symbol.startsWith('$') && symbol !== this._rootSymbol)
            return;
        this._addRuleInternal(this._lookupNonTerminal(symbol), expansion, combiner, attributes);
    }

    _typecheck() {
        if (this._contextual && !this._functionTable.has('context'))
            throw new GenieTypeError(`Missing "context" function for contextual grammar`);

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

    _computeHasContext() {
        // iterate until convergence

        this._nonTermHasContext = [];
        for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++)
            this._nonTermHasContext.push(false);

        let anyChange = true;
        while (anyChange) {
            anyChange = false;

            for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++) {
                const nonTerm = this._nonTermList[nonTermIndex];
                const rules = this._rules[nonTermIndex];

                if (this._nonTermHasContext[nonTermIndex])
                    continue;

                if (this.hasContext(nonTerm)) {
                    this._nonTermHasContext[nonTermIndex] = true;
                    anyChange = true;
                    continue;
                }

                for (let rule of rules) {
                    if (rule.hasContext) {
                        this._nonTermHasContext[nonTermIndex] = true;
                        anyChange = true;
                        break;
                    }

                    let first = rule.expansion[0];
                    if (first instanceof NonTerminal && this.hasContext(first.symbol)) {
                        rule.hasContext = true;
                    } else {
                        for (let expansion of rule.expansion) {
                            if (expansion instanceof NonTerminal && this._nonTermHasContext[expansion.index]) {
                                rule.hasContext = true;
                                break;
                            }
                        }
                    }

                    if (rule.hasContext) {
                        this._nonTermHasContext[nonTermIndex] = true;
                        anyChange = true;
                        break;
                    }
                }
            }
        }

        if (this._options.debug) {
            for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++) {
                if (this._nonTermHasContext[nonTermIndex])
                    console.log(`NT[${this._nonTermList[nonTermIndex]}] depends on context`);
                else
                    console.log(`NT[${this._nonTermList[nonTermIndex]}] does not depend on context`);
            }
        }
        assert(this._nonTermHasContext[this._rootIndex]);
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
        if (this._contextual)
            this._computeHasContext();

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

    _estimateDepthSize(charts, depth, firstGeneration) {
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
                let [/*maxdepth*/, /*worstCaseGenSize*/, estimatedGenSize]
                    = estimateRuleSize(charts, depth, index, rule, this._averagePruningFactor, this._options);

                const ruleTargetSize = this._getRuleTarget(rule, index, depth, firstGeneration);
                estimatedGenSize = Math.min(Math.round(estimatedGenSize), ruleTargetSize);
                estimates[rule.number] = estimatedGenSize;
                estimate += estimatedGenSize;
            }
        }
        return [estimate, ruleEstimates];
    }

    _enableAllRules() {
        for (let index = 0; index < this._nonTermList.length; index++) {
            for (let rule of this._rules[index])
                rule.enabled = true;
        }
    }

    _disableUnreachableRules(charts) {
        // disable all rules that use contexts that are empty

        // iteratively propagate disabling the rules

        // initially, all non-terminals are disabled, except the root, and all rules are disabled
        let nonTermEnabled = [];
        for (let index = 0; index < this._nonTermList.length; index++) {
            nonTermEnabled[index] = false;

            for (let rule of this._rules[index])
                rule.enabled = false;
        }
        nonTermEnabled[this._rootIndex] = true;

        let anyChange = true;

        while (anyChange) {
            anyChange = false;

            // for all enabled non-terminals:
            //   for all rules:
            //     if the rule has a context non-terminal that is not empty, enable the rule and all the non-terminals it uses
            //     if the rule has a context non-terminal that is empty, do nothing
            //     if the rule does not have a context non-terminals, enable the rule and all the non-terminals it uses

            for (let index = 0; index < this._nonTermList.length; index++) {
                if (!nonTermEnabled[index])
                    continue;

                for (let rule of this._rules[index]) {
                    // if this rule was already enabled, do nothing
                    if (rule.enabled)
                        continue;

                    const first = rule.expansion[0];
                    if (first instanceof NonTerminal && this.hasContext(first.symbol)) {
                        // first terminal is a context

                        if (charts[0][first.index].length > 0) {
                            // we have at least one element: enable this rule
                            if (this._options.debug)
                                console.log(`enabling rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
                            rule.enabled = true;
                            anyChange = true;

                            for (let expansion of rule.expansion) {
                                if (expansion instanceof NonTerminal)
                                    nonTermEnabled[expansion.index] = true;
                            }
                        } else {
                            // else do nothing, rule stays disabled
                        }
                    } else {
                        // enable this rule unconditionally
                        if (this._options.debug)
                            console.log(`enabling rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
                        rule.enabled = true;
                        anyChange = true;
                        for (let expansion of rule.expansion) {
                            if (expansion instanceof NonTerminal)
                                nonTermEnabled[expansion.index] = true;
                        }
                    }
                }
            }
        }
    }

    _addConstantsFromContext(context) {
        // disable all rules that generate constants
        for (let index = 0; index < this._nonTermList.length; index++) {
            for (let rule of this._rules[index]) {
                if (rule.forConstant)
                    rule.enabled = false;
            }
        }

        // ask the target language to extract the constants from the context
        const constants = this._target.extractConstants(context.context);

        // create temporary rules generating these constants
        // these rules are added to all the non-terminals where we saw a `const()` declaration
        const attributes = { forConstant: true, temporary: true };

        for (let token in constants) {
            for (let symbolId of this._constantMap.get(token)) {
                for (let constant of constants[token]) {
                    this._addRuleInternal(symbolId, [constant.display], (() => new Derivation(constant.value, List.singleton(constant.display))), attributes);
                    if (this._options.debug)
                        console.log(`added temporary rule NT[${this._nonTermList[symbolId]}] -> ${constant.display}`);
                }
            }
        }
    }

    _removeTemporaryRules() {
        for (let index = 0; index < this._nonTermList.length; index++)
            this._rules[index] = this._rules[index].filter((r) => !r.temporary);
    }

    /**
     * Generate a single sentence or dialogue turn, given the single context.
     *
     * This method will expand the grammar then sample exactly one derivation out of the root non-terminal.
     *
     * This method is optimized for individual generation, and prune the set of enabled rules
     * based on the context. It cannot be called for non-contextual grammars. No `progress` events will
     * be emitted during this method.
     *
     * @param context {any} - the current context
     * @return {Derivation} - the sampled derivation
     */
    generateOne(context) {
        this.finalize();
        assert(this._contextual);

        const rootSampler = new ReservoirSampler(1, this._options.rng);

        const charts = [];

        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            if (this._options.debug)
                console.log(`--- DEPTH ${depth}`);
            const depthbegin = Date.now();

            const targetPruningSize = this._options.targetPruningSize * POWERS[depth];
            charts[depth] = [];
            for (let index = 0; index < this._nonTermList.length; index++) {
                if (this._contextual && depth === 0 && this.hasContext(this._nonTermList[index]))
                    charts[depth][index] = [];
                else
                    charts[depth][index] = new ReservoirSampler(Math.ceil(targetPruningSize), this._options.rng);
            }
            assert(charts[depth].length === this._nonTermList.length);

            if (this._contextual && depth === 0) {
                this._initializeContexts([context], charts, depth);
                this._disableUnreachableRules(charts);
                this._addConstantsFromContext(context);
            }

            for (let index = 0; index < this._nonTermList.length; index++) {
                const minDistance = this._minDistanceFromRoot[index];
                if (minDistance === undefined || minDistance > this._options.maxDepth - depth)
                    continue;
                const isRoot = index === this._rootIndex;

                let nonTermSize = 0;
                for (const rule of this._rules[index]) {
                    if (!rule.enabled)
                        continue;

                    let ruleTarget = this._getRuleTarget(rule, index, depth, true);
                    let sampler = new ReservoirSampler(ruleTarget, this._options.rng);
                    try {
                        expandRule(charts, depth, index, rule, this._averagePruningFactor, this._options, this._nonTermList, (derivation) => {
                            if (derivation === null)
                                return;
                            sampler.add(derivation);
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

                    for (let derivation of sampler)
                        charts[depth][index].add(derivation);
                }
                nonTermSize = charts[depth][index].length;
                if (isRoot) {
                    for (let derivation of charts[depth][index])
                        rootSampler.add(derivation);
                    charts[depth][index].reset();
                }

                if (this._options.debug && nonTermSize > 0)
                    console.log(`stats: size(charts[${depth}][${this._nonTermList[index]}]) = ${nonTermSize}`);
            }

            if (this._options.debug) {
                console.log(`depth ${depth} took ${((Date.now() - depthbegin)/1000).toFixed(2)} seconds`);
                console.log();
            }
        }

        this._removeTemporaryRules();

        return rootSampler.sampled[0];
    }

    _getRuleTarget(rule, nonTermIndex, depth, firstGeneration) {
        const nonTermHasContext = this._nonTermHasContext[nonTermIndex];
        if (!firstGeneration && !nonTermHasContext)
            return 0;

        let targetPruningSize = this._options.targetPruningSize * POWERS[depth];
        if (!nonTermHasContext)
            targetPruningSize *= NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER;

        return Math.min(3 * Math.ceil(targetPruningSize * rule.weight), MAX_SAMPLE_SIZE);
    }

    /**
     * Convert the context inputs into something suitable to pass to the semantic functions.
     *
     * `contextInputs` is an array of arbitrary objects, each corresponding to one possible
     * context to use. Each object will be passed to the `contextInitializer` function that
     * was passed when constructing the grammar.
     *
     * The contextInitializer returns a tuple with the "context tags" (a list of grammar
     * non-terminals declared in a "context" statement) and the "context info", which is actually
     * passed to the semantic function.
     * The input to the context initializer and the info are stored in a Context object,
     * which is then set as the .context property of the derivation.
     *
     * When generating agent sentences, contextInputs is an array of PartialDialogues,
     * each having .context which is the C: state of the dialogue.
     * We call the "context" function to compute the tags and the info.
     *
     * When generating user sentences, contextInputs is an array of agent turns. The turns
     * already contain the tags and the context info (computed by the semantic function
     * of the agent derivation).
     *
     * This fairly convoluted design allows two things:
     * - "Grammar" (this class) has no notion of user or agent, all it knows is to put the right
     *   stuff in the right non-terminals and generate.
     * - The templates can define arbitrary tags for the context, and can define arbitrary functions
     *   to tag the C: state context (the result of simulation).
     * - The templates can pass arbitrary information from the agent turns to the user turns,
     *   including information that is not representable in a ThingTalk dialogue state.
     */
    _initializeContexts(contextInputs, charts, depth) {
        for (let ctxIn of contextInputs) {
            try {
                const result = this._contextInitializer(ctxIn, this._functionTable);
                if (result !== null) {
                    const [tags, info] = result;
                    const ctx = new Context(ctxIn, info);
                    for (let tag of tags) {
                        const index = this._contextTable.get(tag);
                        assert (index !== undefined, `Invalid context tag ${tag}`);
                        charts[depth][index].push(ctx);
                    }
                }
            } catch(e) {
                console.error(ctxIn);
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

    /**
     * Generate a batch of sentences (or dialogue turns), given the batch of contexts.
     *
     * This method is optimized for batch generation, and will cache intermediate generations
     * that do not depend on the context between subsequent calls.
     */
    generate(contextInputs, callback) {
        this.finalize();

        // enable all rules (in case we called generateOne before)
        this._enableAllRules();

        // reset progress counter for this round (only if contextual)
        this._progress = 0;

        // compute the level of progress bar that should be reached at the end of each depth
        // using the heuristic coefficients, renormalized based on the chosen max depth
        const progressAtDepth = [DEPTH_PROGRESS_MULTIPLIERS[0]];
        for (let depth = 1; depth <= this._options.maxDepth; depth++)
            progressAtDepth.push(progressAtDepth[depth-1] + DEPTH_PROGRESS_MULTIPLIERS[depth]);
        for (let depth = 0; depth <= this._options.maxDepth; depth++)
            progressAtDepth[depth] /= progressAtDepth[progressAtDepth.length-1];

        // initialize the charts that will be shared across all invocations of generate()

        let firstGeneration = true;
        if (this._contextual) {
            if (this._charts === undefined) {
                this._charts = [];
                for (let depth = 0; depth <= this._options.maxDepth; depth++) {
                    // multiply non-contextual non-terminals by a factor
                    const targetPruningSize = NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER * this._options.targetPruningSize * POWERS[depth];

                    this._charts[depth] = [];
                    for (let index = 0; index < this._nonTermList.length; index++) {
                        if (!this._nonTermHasContext[index])
                            this._charts[depth][index] = new ReservoirSampler(Math.ceil(targetPruningSize), this._options.rng);
                        else
                            this._charts[depth][index] = undefined; // keep the array dense
                    }
                }

                firstGeneration = true;
            } else {
                firstGeneration = false;
            }
        }

        const charts = [];
        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            if (this._options.debug)
                console.log(`--- DEPTH ${depth}`);
            const depthbegin = Date.now();

            const targetPruningSize = this._options.targetPruningSize * POWERS[depth];
            charts[depth] = [];
            for (let index = 0; index < this._nonTermList.length; index++) {
                // use the shared chart if we can, otherwise make a fresh one

                if (this._contextual && depth === 0 && this.hasContext(this._nonTermList[index]))
                    charts[depth][index] = [];
                else if (!this._contextual || this._nonTermHasContext[index])
                    charts[depth][index] = new ReservoirSampler(Math.ceil(targetPruningSize), this._options.rng);
                else
                    charts[depth][index] = this._charts[depth][index];
            }
            assert(charts[depth].length === this._nonTermList.length);

            if (this._contextual && depth === 0)
                this._initializeContexts(contextInputs, charts, depth);

            // compute estimates of how many things we will produce at this depth
            let [estimatedTotal, estimatedPerRule] = this._estimateDepthSize(charts, depth, firstGeneration);
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

                // if we have already generated this non-terminal, and it does not depend on the context, we have nothing left to do
                if (!firstGeneration && !this._nonTermHasContext[index])
                    continue;

                let nonTermSize = 0;
                for (const rule of this._rules[index]) {
                    if (!rule.enabled)
                        continue;

                    let ruleProductivity = 0;
                    let ruleTarget = this._getRuleTarget(rule, index, depth, firstGeneration);
                    let sampler = new ReservoirSampler(ruleTarget, this._options.rng);
                    try {
                        expandRule(charts, depth, index, rule, this._averagePruningFactor, ruleTarget, this._options, this._nonTermList, (derivation) => {
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

// powers grow by 2 until depth 6, then go down by 0.8
const POWERS = [1, 2, 4, 8, 16, 32, 64];
for (let i = 7; i < 20; i++)
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
    return [maxdepth, worstCaseGenSize, estimatedGenSize, estimatedPruneFactor];
}

function expandRule(charts, depth, nonTermIndex, rule, averagePruningFactor, targetPruningSize, options, nonTermList, emit) {
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

    const [maxdepth, worstCaseGenSize, estimatedGenSize, estimatedPruneFactor] =
        estimateRuleSize(charts, depth, nonTermIndex, rule, averagePruningFactor, options);

    if (maxdepth < depth-1 && options.debug)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : reduced max depth to avoid exponential behavior`);
    if (worstCaseGenSize === 0)
        return;

    /*if (options.debug)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : worst case ${worstCaseGenSize}, expect ${Math.round(estimatedGenSize)}`);
    */

    const now = Date.now();

    // to avoid spending too much time calling the combiner for things we'll prune later,
    // we randomly sample out of all possible combinations about as many as we estimate
    // we'll need to fill the reservoir
    const basicCoinProbability = Math.min(1, targetPruningSize / estimatedGenSize);
    let coinProbability = basicCoinProbability;

    let choices = [];
    //let depths = [];
    let actualGenSize = 0;
    let prunedGenSize = 0;
    for (let i = 0; i < expansion.length; i++) {
        let fixeddepth = depth-1;
        (function recursiveHelper(k, context) {
            if (k === expansion.length) {
                //console.log('combine: ' + choices.join(' ++ '));
                //console.log('depths: ' + depths);
                if (!(coinProbability < 1.0) || coin(coinProbability, rng)) {
                    let v = combiner(choices.map((c) => c instanceof Choice ? c.choose(rng) : c));
                    if (v !== null) {
                        actualGenSize ++;
                        if (actualGenSize < targetPruningSize / 2 &&
                            actualGenSize + prunedGenSize >= 1000 &&
                            actualGenSize / (actualGenSize + prunedGenSize) < 0.001 * estimatedPruneFactor) {
                            // this combiner is pruning so aggressively it's messing up our sampling
                            // disable it
                            coinProbability = 1;
                        }
                        // unless we have generated more than half of our target size, then we bring it back
                        if (actualGenSize >= targetPruningSize / 2)
                            coinProbability = basicCoinProbability;

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
                        let newContext;
                        if (candidate instanceof Context) {
                            if (!contextCompatible(context, candidate))
                                continue;
                            newContext = candidate;
                        } else {
                            assert(candidate instanceof Derivation);
                            if (!contextCompatible(context, candidate.context))
                                continue;
                            newContext = meetContext(context, candidate.context);
                        }
                        if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                            continue;
                        choices[k] = candidate;
                        //depths[k] = fixeddepth;
                        recursiveHelper(k+1, newContext);
                    }
                }
                return;
            }
            if (expansion[k] instanceof NonTerminal) {
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++) {
                    for (let candidate of charts[j][expansion[k].index]) {
                        let newContext;
                        if (candidate instanceof Context) {
                            if (!contextCompatible(context, candidate))
                                continue;
                            newContext = candidate;
                        } else {
                            assert(candidate instanceof Derivation);
                            if (!contextCompatible(context, candidate.context))
                                continue;
                            newContext = meetContext(context, candidate.context);
                        }
                        if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                            continue;
                        choices[k] = candidate;
                        //depths[k] = j;
                        recursiveHelper(k+1, newContext);
                    }
                }
            } else {
                choices[k] = expansion[k];
                recursiveHelper(k+1, context);
            }
        })(0, null);
    }

    //console.log('expand $' + nonterminal + ' -> ' + expansion.join('') + ' : actual ' + actualGenSize);

    if (actualGenSize + prunedGenSize === 0)
        return;
    const newEstimatedPruneFactor = actualGenSize / (actualGenSize + prunedGenSize);

    const elapsed = Date.now() - now;
    if (options.debug && elapsed >= 10000)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : took ${(elapsed/1000).toFixed(2)} seconds`);

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
