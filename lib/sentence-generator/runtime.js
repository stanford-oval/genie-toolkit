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
const events = require('events');

const { uniform } = require('../random');

const {
    Constant,
    Derivation
} = require('./derivations');

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
            if (topLevel) {
                let min;
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

class NonTerminal {
    constructor(symbol) {
        this.symbol = symbol;
        this.isContext = false;
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
    constructor(expansion, combiner) {
        this.expansion = expansion;
        this.combiner = combiner;

        this.height = 0;
    }
}

// the maximum number of distinct constants of a certain type in a program
const DEFAULT_MAX_CONSTANTS = 5;

class GenieTypeError extends Error {
}

class Grammar extends events.EventEmitter {
    constructor(options) {
        super();

        this._options = options || {};
        this._rng = options.rng;
        this._rules = {
            $root: []
        };
        this._contexts = {};

        this._contextual = options.contextual;

        this._finalized = false;
        this._averagePruningFactor = {};
        this._minDistanceFromRoot = {};

        this._numNonTerminals = 0;
        this._nonTerminalHeight = {};

        this._progress = 0;
    }

    get progress() {
        return this._progress;
    }

    hasSymbol(symbol) {
        return Object.prototype.hasOwnProperty.call(this._rules, symbol);
    }

    hasContext(symbol) {
        return Object.prototype.hasOwnProperty.call(this._contexts, symbol);
    }

    declareContext(context, fn) {
        if (this.hasSymbol(context))
            throw new GenieTypeError(`Identifier ${context} cannot be both a context and a non-terminal`);
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot declare more contexts`);
        if (!this._contextual)
            throw new GenieTypeError(`Grammar is not contextual, cannot include context statements`);

        this._contexts[context] = fn;
    }

    declareSymbol(symbol) {
        if (this.hasContext(symbol))
            throw new GenieTypeError(`Identifier ${symbol} cannot be both a context and a non-terminal`);
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, declare more non-terminals`);

        if (!this._rules[symbol]) {
            this._rules[symbol] = [];
            this._numNonTerminals ++;
        }
    }

    addConstants(symbol, token, type) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);
        for (let i = 0; i < (this._options.maxConstants || DEFAULT_MAX_CONSTANTS); i++) {
            let constant = new Constant(token, i, type);
            this._rules[symbol].push(new Rule([constant], () => new Derivation(constant.value, [constant])));
        }
    }

    addRule(symbol, expansion, combiner) {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);
        this._rules[symbol].push(new Rule(expansion, combiner));
    }

    _typecheck() {
        for (let category in this._rules) {
            for (let rule of this._rules[category]) {
                let first = true;
                let hasContext = false;

                for (let expansion of rule.expansion) {
                    if (expansion instanceof NonTerminal) {
                        if (this.hasContext(expansion.symbol)) {
                            if (!first)
                                throw new GenieTypeError(`Context symbol ${expansion.symbol} must be first in expansion of ${category}`);
                            hasContext = true;
                            expansion.isContext = true;
                            first = false;
                            continue;
                        }

                        if (!this._rules[expansion.symbol])
                            throw new Error(`Non-terminal ${expansion.symbol} undefined, referenced by ${category}`);
                    }

                    first = false;
                }

                if (hasContext && rule[0].length === 1)
                    throw new GenieTypeError(`Rule with context must have an additional component in expansion of ${category}`);
            }
        }
    }

    _computeDistanceFromRoot() {
        let queue = [];
        for (let name in this._contexts)
            this._minDistanceFromRoot[name] = 0;
        this._minDistanceFromRoot.$root = 0;
        queue.push(['$root', 0]);

        while (queue.length > 0) {
            let [category, distance] = queue.shift();
            if (distance > this._minDistanceFromRoot[category])
                continue;

            for (let rule of this._rules[category]) {
                for (let expansion of rule.expansion) {
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

    _computeRuleHeight(rule, recursionLimit) {
        let ruleHeight = 0;
        for (let expansion of rule.expansion) {
            if (expansion instanceof NonTerminal && !this.hasContext(expansion.symbol))
                ruleHeight = Math.max(ruleHeight, 1 + this._computeRuleAndNonTerminalHeight(expansion.symbol, recursionLimit - 1));
        }

        rule.height = ruleHeight;
        return ruleHeight;
    }

    _computeRuleAndNonTerminalHeight(nonTerm, recursionLimit) {
        if (nonTerm in this._nonTerminalHeight && this._nonTerminalHeight[nonTerm] < Infinity)
            return this._nonTerminalHeight[nonTerm];
        if (recursionLimit < 0)
            return Infinity;

        let minHeight = Infinity;
        for (let rule of this._rules[nonTerm])
            minHeight = Math.min(minHeight, this._computeRuleHeight(rule, recursionLimit));

        this._nonTerminalHeight[nonTerm] = minHeight;
        return minHeight;
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

                if (this._options.debug)
                    console.log(`rule NT[${category}] -> ${rule.expansion.join(' ')}`);
            }
        }

        this._computeDistanceFromRoot();

        // use DFS with iterative deepening to compute the minimum number of steps necessary
        // to reach a leaf from each non-terminal
        //
        // we start a DFS from each non-terminal down towards the leaves
        // initially, all nonterminals are unset (they have nonTerminalHeight undefined/Infinity)
        // at depth 0, the leaves become set and the rest goes to Infinity
        // at depth 1, the leaves stay set, and any node that can reach a leaf goes to 1
        // etc.
        for (let maxDepth = 0; maxDepth < this._numNonTerminals; maxDepth++) {
            for (let category in this._rules)
                this._computeRuleAndNonTerminalHeight(category, this._numNonTerminals);
        }

        for (let category in this._rules) {
            if (this._minDistanceFromRoot[category] === undefined)
                continue;

            assert(this._nonTerminalHeight[category] !== undefined, category);

            if (this._nonTerminalHeight[category] === 0) {
                // this happens with autogenerated projection non-terminals of weird types
                // that cannot be parameter passed
                console.log(`nonterm NT[${category}] -> leaf`);
            } else {
                console.log(`nonterm NT[${category}] -> ${this._nonTerminalHeight[category]} steps from any leaf`);
            }
        }

        // sort all rules by height, with the highest rules first
        for (let category in this._rules) {
            for (let rule of this._rules[category]) {
                // update the rule height again after computing the height of all non-terminals
                this._computeRuleHeight(rule, 0);
            }
            this._rules[category].sort((one, two) => two.height - one.height);
        }
    }

    /* instanbul ignore next */
    generate(contexts) {
        throw new Error('Abstract method');
    }
}

//const everything = new Set;

module.exports = {
    Grammar,
    NonTerminal,
    Choice,
    Rule,

    simpleCombine,
    combineReplacePlaceholder
};
