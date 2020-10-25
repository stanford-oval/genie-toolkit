// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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
import * as events from 'events';

import * as I18n from '../i18n';
import MultiMap from '../utils/multimap';
import { ReservoirSampler, uniform, coin } from '../utils/random';
import PriorityQueue from '../utils/priority_queue';
import * as TargetLanguages from '../languages';

import List from './list';
import * as SentenceGeneratorRuntime from './runtime';
import {
    LogLevel,

    Choice,
    Context,
    Derivation,
    NonTerminal,
    CombinerAction,
    DerivationChild,
} from './runtime';
import { importGenie } from './compiler';

type RuleExpansionChunk = string | Choice | NonTerminal;

interface RuleAttributes {
    weight ?: number;
    priority ?: number;
    repeat ?: boolean;
    forConstant ?: boolean;
    temporary ?: boolean;
    identity ?: boolean;
    expandchoice ?: boolean;
}

class Rule<ArgTypes extends unknown[], ReturnType> {
    number : number;
    expansion : RuleExpansionChunk[];
    combiner : CombinerAction<ArgTypes, ReturnType>;

    weight : number;
    priority : number;
    repeat : boolean;
    forConstant : boolean;
    temporary : boolean;
    identity : boolean;
    expandchoice : boolean;

    hasContext : boolean;
    enabled : boolean;

    constructor(number : number,
                expansion : RuleExpansionChunk[],
                combiner : CombinerAction<ArgTypes, ReturnType>,
                { weight = 1, priority = 0, repeat = false, forConstant = false, temporary = false,
                  identity = false, expandchoice = true } : RuleAttributes) {
        this.number = number;
        this.expansion = expansion;
        assert(this.expansion.length > 0);
        this.combiner = combiner;

        // attributes
        this.weight = weight;
        assert(Number.isFinite(weight));
        this.priority = priority;
        assert(Number.isFinite(priority));
        this.repeat = repeat;
        this.forConstant = forConstant;
        this.temporary = temporary;
        this.identity = identity;
        this.expandchoice = expandchoice;

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
const NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER = 3;

// powers grow by 2 until depth 6, then go down by 0.8
const POWERS = [1];
for (let i = 1; i < 7; i++)
    POWERS[i] = 2 * POWERS[i-1];
for (let i = 7; i < 20; i++)
    POWERS[i] = 0.8 * POWERS[i-1];
const EXPONENTIAL_PRUNE_SIZE = 500000000;
const MAX_SAMPLE_SIZE = 1000000;

type FunctionTable = Map<string, (...args : any[]) => any>;

type ContextInitializer<ContextType> = (previousTurn : ContextType, functionTable : FunctionTable) => [string[], unknown]|null;

interface GenericSentenceGeneratorOptions {
    locale : string;
    targetLanguage ?: string;
    templateFiles : string[];
    flags : { [key : string] : boolean };
    rootSymbol ?: string;
    targetPruningSize : number;
    maxDepth : number;
    maxConstants : number;
    debug : number;
    rng : () => number;

    // options passed to the templates
    thingpediaClient ?: any;
    schemaRetriever ?: any;
    onlyDevices ?: string[];
    whiteList ?: string;
}

interface BasicSentenceGeneratorOptions {
    contextual : false;
    contextInitializer ?: undefined;
}

interface ContextualSentenceGeneratorOptions<ContextType> {
    contextual : true;
    rootSymbol ?: string;
    contextInitializer : ContextInitializer<ContextType>;
}

export type SentenceGeneratorOptions<ContextType> =
    GenericSentenceGeneratorOptions &
    (BasicSentenceGeneratorOptions | ContextualSentenceGeneratorOptions<ContextType>);

interface Constant {
    display : string;
    value : unknown;
}

type Charts = Array<Array<ReservoirSampler<any>>>;

/**
 * Low-level class that generates sentences and associated logical forms,
 * given a grammar expressed as Genie template files.
 */
export default class SentenceGenerator<ContextType, RootOutputType> extends events.EventEmitter {
    private _templateFiles : string[];
    private _langPack : I18n.LanguagePack;

    private _target : TargetLanguages.TargetLanguage;

    private _options : SentenceGeneratorOptions<ContextType>;
    private _contextual : boolean;

    private _nonTermTable : Map<string, number>;
    private _nonTermList : string[];
    private _rules : Array<Array<Rule<any[], any>>>;
    private _contextTable : Map<string, number>;
    private _functionTable : FunctionTable;

    private _rootSymbol : string;
    private _rootIndex : number;

    private _contextInitializer : ContextInitializer<ContextType>|undefined;

    private _constantMap : MultiMap<string, number>;

    private _finalized : boolean;
    private _averagePruningFactor : number[][];
    private _minDistanceFromRoot : number[];
    private _nonTermHasContext : boolean[];

    private _charts : Charts;

    private _progress : number;

    constructor(options : SentenceGeneratorOptions<ContextType>) {
        super();

        this._templateFiles = options.templateFiles;
        this._langPack = I18n.get(options.locale);

        this._target = TargetLanguages.get(options.targetLanguage);
        this._options = options;
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

        this._charts = [];

        this._progress = 0;
    }

    async initialize() : Promise<void> {
        for (const filename of this._templateFiles) {
            const imported = await importGenie(filename);
            await imported(SentenceGeneratorRuntime, this._options, this._langPack, this);
        }
        this.finalize();
    }

    get progress() : number {
        return this._progress;
    }

    hasSymbol(symbol : string) : boolean {
        return this._nonTermTable.has(symbol);
    }

    hasContext(symbol : string) : boolean {
        return this._contextTable.has(symbol);
    }

    private _internalDeclareSymbol(symbol : string) : number {
        const index = this._nonTermList.length;
        this._nonTermList.push(symbol);
        this._rules.push([]);
        assert(this._rules.length === this._nonTermList.length);
        this._nonTermTable.set(symbol, index);
        return index;
    }

    declareFunction(name : string, fn : (...args : any[]) => any) : void {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot declare more functions`);
        if (this._functionTable.has(name))
            throw new GenieTypeError(`Function ${name} already declared`);
        this._functionTable.set(name, fn);
    }

    declareContext(context : string) : void {
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

    declareSymbol(symbol : string) : void {
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

    private _lookupNonTerminal(symbol : string) : number {
        const index = this._nonTermTable.get(symbol);
        if (index === undefined)
            throw new GenieTypeError(`Identifier ${symbol} is not a non-terminal`);
        return index;
    }

    private _addRuleInternal<ArgTypes extends unknown[], ResultType>(symbolId : number,
                                                                     expansion : RuleExpansionChunk[],
                                                                     combiner : CombinerAction<ArgTypes, ResultType>,
                                                                     attributes : RuleAttributes = {}) {
        const rulenumber = this._rules[symbolId].length;
        this._rules[symbolId].push(new Rule<any[], any>(rulenumber, expansion, combiner as CombinerAction<any[], any>, attributes));
    }

    addConstants(symbol : string, token : string, type : any, attributes : RuleAttributes = {}) : void {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);
        // ignore $user when loading the agent templates and vice-versa
        if (symbol.startsWith('$') && symbol !== this._rootSymbol)
            return;

        const symbolId = this._lookupNonTerminal(symbol);
        this._constantMap.put(token, symbolId);

        attributes.forConstant = true;
        for (const constant of this._target.createConstants(token, type, this._options.maxConstants || DEFAULT_MAX_CONSTANTS)) {
            const sentencepiece = constant.display;
            const combiner = () => new Derivation(constant.value, List.singleton(sentencepiece), null, attributes.priority || 0);
            this._addRuleInternal(symbolId, [sentencepiece], combiner, attributes);
        }
    }

    addRule<ArgTypes extends unknown[], ResultType>(symbol : string,
                                                    expansion : RuleExpansionChunk[],
                                                    combiner : CombinerAction<ArgTypes, ResultType>,
                                                    attributes : RuleAttributes = {}) : void {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);
        // ignore $user when loading the agent templates and vice-versa
        if (symbol.startsWith('$') && symbol !== this._rootSymbol)
            return;
        this._addRuleInternal(this._lookupNonTerminal(symbol), expansion, combiner, attributes);
    }

    private _typecheck() {
        if (this._contextual && !this._functionTable.has('context'))
            throw new GenieTypeError(`Missing "context" function for contextual grammar`);

        for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++) {
            const nonTerm = this._nonTermList[nonTermIndex];
            const rules = this._rules[nonTermIndex];

            for (const rule of rules) {
                let first = true;
                let hasContext = false;

                for (const expansion of rule.expansion) {
                    if (expansion instanceof NonTerminal) {
                        if (this.hasContext(expansion.symbol)) {
                            if (!first)
                                throw new GenieTypeError(`Context symbol ${expansion.symbol} must be first in expansion of ${nonTerm}`);
                            hasContext = true;
                            first = false;
                            expansion.index = this._nonTermTable.get(expansion.symbol)!;
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

    private _computeHasContext() {
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

                for (const rule of rules) {
                    if (rule.hasContext) {
                        this._nonTermHasContext[nonTermIndex] = true;
                        anyChange = true;
                        break;
                    }

                    const first = rule.expansion[0];
                    if (first instanceof NonTerminal && this.hasContext(first.symbol)) {
                        rule.hasContext = true;
                    } else {
                        for (const expansion of rule.expansion) {
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

        if (this._options.debug >= LogLevel.DUMP_DERIVED) {
            for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++) {
                if (this._nonTermHasContext[nonTermIndex])
                    console.log(`NT[${this._nonTermList[nonTermIndex]}] depends on context`);
                else
                    console.log(`NT[${this._nonTermList[nonTermIndex]}] does not depend on context`);
            }
        }
        assert(this._nonTermHasContext[this._rootIndex]);
    }

    private _computeDistanceFromRoot() {
        // fill the array so it dense
        for (let i = 0; i < this._nonTermList.length; i++)
            this._minDistanceFromRoot.push(1<<29); // integer infinity
        assert(this._nonTermList.length === this._minDistanceFromRoot.length);

        const queue : Array<[number, number]> = [];
        for (const index of this._contextTable.values())
            this._minDistanceFromRoot[index] = 0;
        this._minDistanceFromRoot[this._rootIndex] = 0;
        queue.push([this._rootIndex, 0]);

        while (queue.length > 0) {
            const [index, distance] = queue.shift()!;
            if (distance > this._minDistanceFromRoot[index])
                continue;

            for (const rule of this._rules[index]) {
                for (const expansion of rule.expansion) {
                    if (expansion instanceof NonTerminal) {
                        assert(expansion.index !== undefined);
                        const existingDistance = this._minDistanceFromRoot[expansion.index];
                        if (!(distance+1 >= existingDistance)) { // undefined/NaN-safe comparison
                            this._minDistanceFromRoot[expansion.index] = distance+1;
                            queue.push([expansion.index, distance+1]);
                        }
                    }
                }
            }
        }

        if (this._options.debug >= LogLevel.DUMP_DERIVED) {
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

    private _addAutomaticRepeat() {
        for (let index = 0; index < this._nonTermList.length; index++) {
            let shouldSetRepeat = false;
            for (const rule of this._rules[index]) {
                if (rule.repeat || rule.weight !== 1) {
                    shouldSetRepeat = true;
                    break;
                }
            }

            if (shouldSetRepeat) {
                for (const rule of this._rules[index])
                    rule.repeat = true;
            }
        }
    }

    private _optimizeConstLikeNonTerminals() {
        // replace non-terminals that only expand to strings with no semantic functions
        // into choice terminals
        //
        // that, is optimize:
        // ```
        // thanks_phrase = {
        //   'thank you';
        //   'thanks';
        // }
        // foo = {
        //   thanks_phrase bar => ...
        // }
        // ```
        // into
        // ```
        // thanks_phrase = {
        //   'thank you';
        //   'thanks';
        // }
        // foo = {
        //   ('thank you' | 'thanks') bar => ...
        // }
        // ```
        //
        // this is faster to generate because we don't need to enumerate thanks phrase

        const choiceLikeNonTerms = new Map;
        for (let index = 0; index < this._nonTermList.length; index++) {
            // if there is only one expansion, this optimization has no effect,
            // and if there is none, it will break things
            if (this._rules[index].length <= 1)
                continue;

            let isChoiceLike = true;
            const choices = [];
            for (const rule of this._rules[index]) {
                if (rule.expansion.length !== 1 ||
                    typeof rule.expansion[0] !== 'string' ||
                    !rule.identity) {
                    isChoiceLike = false;
                    break;
                }
                choices.push(rule.expansion[0]);
            }
            if (isChoiceLike) {
                choiceLikeNonTerms.set(index, new Choice(choices));
                if (this._options.debug >= LogLevel.DUMP_DERIVED)
                    console.log(`non-term NT[${this._nonTermList[index]}] is choice-like`);
            }
        }

        for (let index = 0; index < this._nonTermList.length; index++) {
            for (const rule of this._rules[index]) {
                if (!rule.expandchoice)
                    continue;

                // if there is only one non-terminal in this rule, we don't apply
                // the optimization because it will change the sampling pattern quite a bit
                // and we don't want that
                if (rule.expansion.length === 1)
                    continue;

                for (let expindex = 0; expindex < rule.expansion.length; expindex++) {
                    const expansion = rule.expansion[expindex];
                    if (expansion instanceof NonTerminal && choiceLikeNonTerms.has(expansion.index))
                        rule.expansion[expindex] = choiceLikeNonTerms.get(expansion.index);
                }
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
        if (!this._options.flags.inference)
            this._optimizeConstLikeNonTerminals();

        for (let index = 0; index < this._nonTermList.length; index++) {
            const prunefactors : number[] = [];
            this._averagePruningFactor.push(prunefactors);

            for (const rule of this._rules[index]) {
                // initialize prune factor estimates to 0.2
                // so we don't start pruning until we have a good estimate
                prunefactors.push(0.2);

                if (this._options.debug >= LogLevel.DUMP_TEMPLATES)
                    console.log(`rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
            }
        }

        this._computeDistanceFromRoot();
    }

    private _estimateDepthSize(charts : Charts, depth : number, firstGeneration : boolean) : [number, number[][]] {
        const ruleEstimates = [];
        let estimate = 0;
        for (let index = 0; index < this._nonTermList.length; index++) {
            const minDistance = this._minDistanceFromRoot[index];
            if (minDistance === undefined || minDistance > this._options.maxDepth - depth)
                continue;
            const rules = this._rules[index];

            const estimates : number[] = [];
            ruleEstimates[index] = estimates;
            estimates.length = rules.length;
            for (const rule of rules) {
                let [/*maxdepth*/, /*worstCaseGenSize*/, estimatedGenSize]
                    = estimateRuleSize(charts, depth, index, rule, this._averagePruningFactor);

                const ruleTargetSize = this._getRuleTarget(rule, index, depth, firstGeneration);
                estimatedGenSize = Math.min(Math.round(estimatedGenSize), ruleTargetSize);
                estimates[rule.number] = estimatedGenSize;
                estimate += estimatedGenSize;
            }
        }
        return [estimate, ruleEstimates];
    }

    private _enableAllRules() {
        for (let index = 0; index < this._nonTermList.length; index++) {
            for (const rule of this._rules[index])
                rule.enabled = true;
        }
    }

    private _disableUnreachableRules(charts : Charts) : void {
        // disable all rules that use contexts that are empty

        // iteratively propagate disabling the rules

        // initially, all non-terminals are disabled, except the root, and all rules are disabled
        const nonTermEnabled = [];
        for (let index = 0; index < this._nonTermList.length; index++) {
            nonTermEnabled[index] = false;

            for (const rule of this._rules[index])
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

                for (const rule of this._rules[index]) {
                    // if this rule was already enabled, do nothing
                    if (rule.enabled)
                        continue;

                    const first = rule.expansion[0];
                    if (first instanceof NonTerminal && this.hasContext(first.symbol)) {
                        // first terminal is a context

                        if (charts[0][first.index].length > 0) {
                            // we have at least one element: enable this rule
                            if (this._options.debug >= LogLevel.EVERYTHING)
                                console.log(`enabling rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
                            rule.enabled = true;
                            anyChange = true;

                            for (const expansion of rule.expansion) {
                                if (expansion instanceof NonTerminal)
                                    nonTermEnabled[expansion.index] = true;
                            }
                        } else {
                            // else do nothing, rule stays disabled
                        }
                    } else {
                        // enable this rule unconditionally
                        if (this._options.debug >= LogLevel.EVERYTHING)
                            console.log(`enabling rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
                        rule.enabled = true;
                        anyChange = true;
                        for (const expansion of rule.expansion) {
                            if (expansion instanceof NonTerminal)
                                nonTermEnabled[expansion.index] = true;
                        }
                    }
                }
            }
        }
    }

    invokeFunction(name : string, ...args : any[]) : any {
        //if (!this._functionTable.has(name))
        //    return null;
        return this._functionTable.get(name)!(...args);
    }

    addConstantsFromContext(constants : { [key : string] : Constant[] }) : void {
        // create temporary rules generating these constants
        // these rules are added to all the non-terminals where we saw a `const()` declaration
        const attributes = {
            forConstant: true,
            temporary: true,
            priority: 0
        };

        for (const token in constants) {
            for (const symbolId of this._constantMap.get(token)) {
                for (const constant of constants[token]) {
                    const combiner = () => new Derivation(constant.value, List.singleton(constant.display), null, attributes.priority);
                    this._addRuleInternal(symbolId, [constant.display], combiner, attributes);
                    if (this._options.debug >= LogLevel.EVERYTHING)
                        console.log(`added temporary rule NT[${this._nonTermList[symbolId]}] -> ${constant.display}`);
                }
            }
        }
    }

    private _removeTemporaryRules() {
        for (let index = 0; index < this._nonTermList.length; index++)
            this._rules[index] = this._rules[index].filter((r) => !r.temporary);
    }

    private _disableRulesForConstants() {
        // disable all rules that generate constants
        // we'll make temporary ones using the constants extracted from the context instead
        for (let index = 0; index < this._nonTermList.length; index++) {
            for (const rule of this._rules[index]) {
                if (rule.forConstant && !rule.temporary) {
                    rule.enabled = false;
                    if (this._options.debug >= LogLevel.EVERYTHING)
                        console.log(`disabling rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
                }
            }
        }
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
    generateOne(context : ContextType) : Derivation<RootOutputType>|undefined {
        this.finalize();
        assert(this._contextual);

        const rootSampler = new PriorityQueue<Derivation<RootOutputType>>();

        const charts : Charts = [];

        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            if (this._options.debug >= LogLevel.INFO)
                console.log(`--- DEPTH ${depth}`);
            const depthbegin = Date.now();

            const targetPruningSize = Math.ceil(this._options.targetPruningSize * POWERS[depth]);
            charts[depth] = [];
            for (let index = 0; index < this._nonTermList.length; index++)
                charts[depth][index] = new ReservoirSampler(Infinity, this._options.rng);
            assert(charts[depth].length === this._nonTermList.length);

            if (this._contextual && depth === 0) {
                this._initializeContexts([context], charts, depth);
                this._disableUnreachableRules(charts);
                this._disableRulesForConstants();
            }

            for (let index = 0; index < this._nonTermList.length; index++) {
                const minDistance = this._minDistanceFromRoot[index];
                if (minDistance === undefined || minDistance > this._options.maxDepth - depth)
                    continue;
                const isRoot = index === this._rootIndex;

                let nonTermSize = 0;
                const queue = new PriorityQueue<Derivation<any>>();
                for (const rule of this._rules[index]) {
                    if (!rule.enabled)
                        continue;

                    try {
                        expandRule(charts, depth, index, rule, this._averagePruningFactor, Infinity, this._options, this._nonTermList, (derivation) => {
                            if (derivation === null)
                                return;
                            queue.push(derivation);
                        });
                    } catch(e) {
                        console.error(`Error expanding rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
                        throw e;
                    }
                }

                const initialSize = charts[depth][index].length;
                nonTermSize = Math.min(queue.size, targetPruningSize);
                for (let i = 0; i < nonTermSize; i++) {
                    const derivation = queue.pop();
                    assert(derivation);
                    if (isRoot)
                        rootSampler.push(derivation);
                    else
                        charts[depth][index].add(derivation);
                }
                nonTermSize += initialSize;
                assert(isRoot || charts[depth][index].length === nonTermSize);
                if (this._options.debug >= LogLevel.GENERATION && nonTermSize > 0)
                    console.log(`stats: size(charts[${depth}][${this._nonTermList[index]}]) = ${nonTermSize}`);
            }

            if (this._options.debug >= LogLevel.INFO) {
                console.log(`depth ${depth} took ${((Date.now() - depthbegin)/1000).toFixed(2)} seconds`);
                console.log();
            }
        }

        this._removeTemporaryRules();

        return rootSampler.pop();
    }

    private _getRuleTarget(rule : Rule<unknown[], unknown>,
                           nonTermIndex : number,
                           depth : number,
                           firstGeneration : boolean) : number {
        const nonTermHasContext = this._nonTermHasContext[nonTermIndex];
        if (!firstGeneration && !nonTermHasContext)
            return 0;

        let targetPruningSize = this._options.targetPruningSize * POWERS[depth];
        if (!nonTermHasContext)
            targetPruningSize *= NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER;

        return Math.min(2 * Math.ceil(targetPruningSize * rule.weight), MAX_SAMPLE_SIZE);
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
    private _initializeContexts(contextInputs : ContextType[],
                                charts : Charts,
                                depth : number) : void {
        for (const ctxIn of contextInputs) {
            try {
                const result = this._contextInitializer!(ctxIn, this._functionTable);
                if (result !== null) {
                    const [tags, info] = result;
                    const ctx = new Context(ctxIn, info);
                    for (const tag of tags) {
                        const index = this._contextTable.get(tag);
                        assert(index !== undefined, `Invalid context tag ${tag}`);
                        charts[depth][index].add(ctx);
                    }
                }
            } catch(e) {
                console.error(ctxIn);
                throw e;
            }
        }

        if (this._options.debug >= LogLevel.GENERATION) {
            for (const index of this._contextTable.values()) {
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
    generate(contextInputs : ContextType[],
             callback : (depth : number, derivation : Derivation<RootOutputType>) => void) : void {
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
            if (this._charts.length === 0) {
                this._charts = [];
                for (let depth = 0; depth <= this._options.maxDepth; depth++) {
                    // multiply non-contextual non-terminals by a factor
                    const targetPruningSize = NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER * this._options.targetPruningSize * POWERS[depth];

                    this._charts[depth] = [];
                    for (let index = 0; index < this._nonTermList.length; index++) {
                        if (!this._nonTermHasContext[index])
                            this._charts[depth][index] = new ReservoirSampler(Math.ceil(targetPruningSize), this._options.rng);
                        else
                            this._charts[depth][index] = new ReservoirSampler(0, this._options.rng); // keep the array dense, this value will never be used
                    }
                }

                firstGeneration = true;
            } else {
                firstGeneration = false;
            }
        }

        const charts : Charts = [];
        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            if (this._options.debug >= LogLevel.INFO)
                console.log(`--- DEPTH ${depth}`);
            const depthbegin = Date.now();

            const targetPruningSize = this._options.targetPruningSize * POWERS[depth];
            charts[depth] = [];
            for (let index = 0; index < this._nonTermList.length; index++) {
                // use the shared chart if we can, otherwise make a fresh one

                // the chart for context symbols is never pruned, but we use
                // a ReservoirSampler nonetheless to keep the types manageable
                if (this._contextual && depth === 0 && this.hasContext(this._nonTermList[index]))
                    charts[depth][index] = new ReservoirSampler(Infinity, this._options.rng);
                else if (!this._contextual || this._nonTermHasContext[index])
                    charts[depth][index] = new ReservoirSampler(Math.ceil(targetPruningSize), this._options.rng);
                else
                    charts[depth][index] = this._charts[depth][index];
            }
            assert(charts[depth].length === this._nonTermList.length);

            if (this._contextual && depth === 0)
                this._initializeContexts(contextInputs, charts, depth);

            // compute estimates of how many things we will produce at this depth
            const [initialEstimatedTotal, estimatedPerRule] = this._estimateDepthSize(charts, depth, firstGeneration);
            let estimatedTotal = initialEstimatedTotal;
            let actual = 0;

            const targetProgress = progressAtDepth[depth];

            // subdivide the remaining progress among the (estimated) derivations we'll generate at this depth
            let progressIncrement : number;
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
                    const ruleTarget = this._getRuleTarget(rule, index, depth, firstGeneration);
                    const sampler = new ReservoirSampler(ruleTarget, this._options.rng);

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
                    let output : Iterable<any> = sampler;
                    if (rule.repeat && sampler.length > 0 && sampler.length < ruleTarget) {
                        const lengthbefore = sampler.length;
                        const array = Array.from(sampler);
                        const lengthafter = sampler.length;
                        assert(lengthbefore === lengthafter);
                        for (let i = sampler.length; i < ruleTarget; i++)
                            array.push(uniform(array, this._options.rng));
                        output = array;
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

                    for (const derivation of output)
                        charts[depth][index].add(derivation);
                }
                nonTermSize = charts[depth][index].length;
                if (isRoot) {
                    for (const derivation of charts[depth][index])
                        callback(depth, derivation);

                    const chart = charts[depth][index];
                    assert(chart instanceof ReservoirSampler);
                    chart.reset();
                }

                if (this._options.debug >= LogLevel.GENERATION && nonTermSize > 0)
                    console.log(`stats: size(charts[${depth}][${this._nonTermList[index]}]) = ${nonTermSize}`);
            }

            if (this._options.debug >= LogLevel.INFO) {
                console.log(`depth ${depth} took ${((Date.now() - depthbegin)/1000).toFixed(2)} seconds`);
                console.log();
            }

            this._progress = targetProgress;
        }

        // ensure that progress goes up to 1 at the end (to close the progress bar)

        this._progress = 1;
    }
}

function computeWorstCaseGenSize(charts : Charts,
                                 depth : number,
                                 rule : Rule<unknown[], unknown>,
                                 maxdepth : number) : number {
    const expansion = rule.expansion;
    const anyNonTerm = expansion.some((x) => x instanceof NonTerminal);
    if (!anyNonTerm)
        return depth === 0 ? 1 : 0;
    if (depth === 0)
        return 0;

    let worstCaseGenSize = 0;
    for (let i = 0; i < expansion.length; i++) {
        const fixeddepth = depth-1;

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
            const currentExpansion = expansion[k];
            if (k === i) {
                if (currentExpansion instanceof NonTerminal)
                    tmp = charts[fixeddepth][currentExpansion.index].length * tmp;
                else
                    tmp = 0;
            } else if (currentExpansion instanceof NonTerminal) {
                let sum = 0;
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++)
                    sum += charts[j][currentExpansion.index].length * tmp;
                tmp = sum;
            }
        }

        worstCaseGenSize += tmp;
    }
    return worstCaseGenSize;
}

function estimateRuleSize(charts : Charts,
                          depth : number,
                          nonTermIndex : number,
                          rule : Rule<unknown[], unknown>,
                          averagePruningFactor : number[][]) : [number, number, number, number] {
    // first compute how many things we expect to produce in the worst case
    let maxdepth = depth-1;
    let worstCaseGenSize = computeWorstCaseGenSize(charts, depth, rule, maxdepth);
    if (worstCaseGenSize === 0)
        return [maxdepth, 0, 0, 1];

    // prevent exponential behavior!
    while (worstCaseGenSize >= EXPONENTIAL_PRUNE_SIZE && maxdepth >= 0) {
        maxdepth--;
        worstCaseGenSize = computeWorstCaseGenSize(charts, depth, rule, maxdepth);
    }
    if (maxdepth < 0 || worstCaseGenSize === 0)
        return [maxdepth, 0, 0, 1];

    const estimatedPruneFactor = averagePruningFactor[nonTermIndex][rule.number];
    const estimatedGenSize = worstCaseGenSize * estimatedPruneFactor;
    return [maxdepth, worstCaseGenSize, estimatedGenSize, estimatedPruneFactor];
}

interface ExpandOptions {
    debug : number;
    rng : () => number;
}

type DerivationChildOrChoice = DerivationChild<any> | Choice;

function assignChoices(choices : DerivationChildOrChoice[], rng : () => number) : Array<DerivationChild<any>> {
    return choices.map((c) => c instanceof Choice ? c.choose(rng) : c);
}

function expandRule(charts : Charts,
                    depth : number,
                    nonTermIndex : number,
                    rule : Rule<any[], any>,
                    averagePruningFactor : number[][],
                    targetPruningSize : number,
                    options : ExpandOptions,
                    nonTermList : string[],
                    emit : (value : Derivation<any>) => void) : void {
    const rng = options.rng;

    const expansion = rule.expansion;
    const combiner = rule.combiner;
    const anyNonTerm = expansion.some((x) => x instanceof NonTerminal);

    if (!anyNonTerm) {
        if (depth === 0) {
            const deriv = combiner(assignChoices(expansion, rng), rule.priority);
            if (deriv !== null)
                emit(deriv);
        }
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
        estimateRuleSize(charts, depth, nonTermIndex, rule, averagePruningFactor);

    if (maxdepth < depth-1 && options.debug >= LogLevel.INFO)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : reduced max depth to avoid exponential behavior`);
    if (worstCaseGenSize === 0)
        return;

    if (options.debug >= LogLevel.EVERYTHING)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : worst case ${worstCaseGenSize}, expect ${Math.round(estimatedGenSize)}`);

    const now = Date.now();

    // to avoid spending too much time calling the combiner for things we'll prune later,
    // we randomly sample out of all possible combinations about as many as we estimate
    // we'll need to fill the reservoir
    const basicCoinProbability = Math.min(1, targetPruningSize / estimatedGenSize);
    let coinProbability = basicCoinProbability;

    const choices : DerivationChildOrChoice[] = [];
    //let depths = [];
    let actualGenSize = 0;
    let prunedGenSize = 0;
    for (let i = 0; i < expansion.length; i++) {
        const fixeddepth = depth-1;
        (function recursiveHelper(k : number, context : Context|null) {
            if (k === expansion.length) {
                //console.log('combine: ' + choices.join(' ++ '));
                //console.log('depths: ' + depths);
                if (!(coinProbability < 1.0) || coin(coinProbability, rng)) {
                    const v = combiner(assignChoices(choices, rng), rule.priority);
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
            const currentExpansion = expansion[k];
            if (k === i) {
                if (currentExpansion instanceof NonTerminal) {
                    for (const candidate of charts[fixeddepth][currentExpansion.index]) {
                        let newContext;
                        if (candidate instanceof Context) {
                            if (!Context.compatible(context, candidate))
                                continue;
                            newContext = candidate;
                        } else {
                            assert(candidate instanceof Derivation);
                            if (!Context.compatible(context, candidate.context))
                                continue;
                            newContext = Context.meet(context, candidate.context);
                            if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                                continue;
                        }
                        choices[k] = candidate;
                        //depths[k] = fixeddepth;
                        recursiveHelper(k+1, newContext);
                    }
                }
                return;
            }
            if (currentExpansion instanceof NonTerminal) {
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++) {
                    for (const candidate of charts[j][currentExpansion.index]) {
                        let newContext;
                        if (candidate instanceof Context) {
                            if (!Context.compatible(context, candidate))
                                continue;
                            newContext = candidate;
                        } else {
                            assert(candidate instanceof Derivation);
                            if (!Context.compatible(context, candidate.context))
                                continue;
                            newContext = Context.meet(context, candidate.context);
                            if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                                continue;
                        }
                        choices[k] = candidate;
                        //depths[k] = j;
                        recursiveHelper(k+1, newContext);
                    }
                }
            } else {
                choices[k] = currentExpansion;
                recursiveHelper(k+1, context);
            }
        })(0, null);
    }

    //console.log('expand $' + nonterminal + ' -> ' + expansion.join('') + ' : actual ' + actualGenSize);

    if (actualGenSize + prunedGenSize === 0)
        return;
    const newEstimatedPruneFactor = actualGenSize / (actualGenSize + prunedGenSize);

    const elapsed = Date.now() - now;
    if (options.debug >= LogLevel.INFO && elapsed >= 10000)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : took ${(elapsed/1000).toFixed(2)} seconds`);

    const movingAverageOfPruneFactor = (0.01 * estimatedPruneFactor + newEstimatedPruneFactor) / (1.01);
    averagePruningFactor[nonTermIndex][rule.number] = movingAverageOfPruneFactor;
}
