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
import {
    ReservoirSampler,
    uniform,
    coin,
    categoricalPrecomputed
} from '../utils/random';
import PriorityQueue from '../utils/priority_queue';
import { HashMultiMap } from '../utils/hashmap';
import * as ThingTalkUtils from '../utils/thingtalk';

import List from './list';
import * as SentenceGeneratorRuntime from './runtime';
import {
    LogLevel,

    Choice,
    Placeholder,
    Context,
    Derivation,
    NonTerminal,
    CombinerAction,
    DerivationKeyValue,
    DerivationChild,
} from './runtime';
import {
    ContextPhrase,
    ContextTable,
    ContextFunction,
} from './types';
import { importGenie } from './compiler';

type RuleExpansionChunk = string | Choice | Placeholder | NonTerminal;

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

interface FunctionTable<StateType> {
    answer ?: (state : StateType, value : unknown, contextTable : ContextTable) => StateType|null;
    context ?: ContextFunction<StateType>;

    [key : string] : ((...args : any[]) => any)|undefined;
}
type ContextInitializer<ContextType, StateType> = (previousTurn : ContextType, functionTable : FunctionTable<StateType>, contextTable : ContextTable) => ContextPhrase[]|null;

interface GenericSentenceGeneratorOptions {
    locale : string;
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

interface ContextualSentenceGeneratorOptions<ContextType, StateType> {
    contextual : true;
    rootSymbol ?: string;
    contextInitializer : ContextInitializer<ContextType, StateType>;
}

export type SentenceGeneratorOptions<ContextType, RootOutputType> =
    GenericSentenceGeneratorOptions &
    (BasicSentenceGeneratorOptions | ContextualSentenceGeneratorOptions<ContextType, RootOutputType>);

interface Constant {
    display : string;
    value : unknown;
}

/**
 * An index (in the DB sense) that keeps track of all derivations compatible
 * with the given key.
 */
type DerivationIndex = HashMultiMap<DerivationKeyValue, Derivation<any>>;

/**
 * The result of expanding a single rule, at a single depth.
 *
 * This is semantically a list of derivations, up to a configurable size.
 * Derivations exceeding the size are pruned.
 *
 * This class adds the logic to keep track of compatible derivations (based on
 * the indices computed by the semantic functions) and sample them efficiently.
 */
class Chart {
    /**
     * All the derivations in this chart.
     */
    private _store : ReservoirSampler<Derivation<any>>;

    /**
     * A map from index name to the index (hash table) mapping a certain
     * key to a list of derivations.
     */
    private _indices : Record<string, DerivationIndex>;

    private _rng : () => number;

    constructor(targetSize : number, rng : () => number) {
        this._store = new ReservoirSampler(targetSize, rng);
        this._indices = {};
        this._rng = rng;
    }

    get size() {
        return this._store.length;
    }

    reset() {
        this._store.reset();
        for (const indexName in this._indices)
            this._indices[indexName].clear();
    }

    /**
     * Iterate all derivations, regardless of key.
     */
    [Symbol.iterator]() : Iterator<Derivation<any>> {
        return this._store[Symbol.iterator]();
    }

    /**
     * Retrieve all derivations for a given key.
     */
    forKey(indexName : string, key : DerivationKeyValue) : ReadonlyArray<Derivation<any>> {
        const map = this._indices[indexName];
        if (!map)
            return [];
        return map.get(key);
    }

    choose() : Derivation<any>|undefined {
        if (this._store.length === 0)
            return undefined;
        return uniform(this._store.sampled, this._rng);
    }

    chooseForKey(indexName : string, key : DerivationKeyValue) : Derivation<any>|undefined {
        const map = this._indices[indexName];
        if (!map)
            return undefined;
        const samples = map.get(key);
        if (!samples.length)
            return undefined;
        return uniform(samples, this._rng);
    }

    add(derivation : Derivation<any>) {
        const sizeBefore = this.size;

        const dropped = this._store.add(derivation);
        let added = false;
        if (dropped !== derivation) {
            // we maybe dropped one, and we definitely added derivation

            if (dropped !== undefined) {
                for (const indexName in dropped.key)
                    this._indices[indexName].deleteValue(dropped.key[indexName], dropped);
            } else {
                added = true;
            }

            for (const indexName in derivation.key)
                this._indices[indexName].put(derivation.key[indexName], derivation);
        }

        assert.strictEqual(this.size, sizeBefore + +added);
        return added;
    }
}

/**
 * All the charts.
 *
 * This object stores all the intermediate derivations generated up to a certain
 * point of the algorithm.
 *
 * This is semantically a 2D array indexed by non-terminal and depth, but it
 * also keeps track of cumulative sizes
 */
class ChartTable {
    private store : Array<Chart|undefined>; // indexed by non-terminal first and depth second
    private _cumSize : number[]; // indexed by non-terminal first and depth second
    private _maxDepth : number;
    private _nonTermList : string[];
    private _currentDepth : number;

    private _rng : () => number;

    constructor(nonTermList : string[],
                maxDepth : number,
                rng : () => number) {
        this.store = [];
        this._currentDepth = -1;
        this._cumSize = [];
        this._maxDepth = maxDepth;
        this._nonTermList = nonTermList;

        this._rng = rng;

        // maxDepth is inclusive, hence the +1 here and elsewhere
        for (let i = 0; i < this._nonTermList.length; i++) {
            for (let j = 0; j < maxDepth+1; j++)
                this.store.push(undefined);
        }

        for (let i = 0; i < this._nonTermList.length; i++) {
            for (let j = 0; j < maxDepth+1; j++)
                this._cumSize.push(0);
        }
    }

    init(nonTermIndex : number, depth : number, targetSize : number) {
        assert(depth === this._currentDepth);
        this.store[nonTermIndex * (this._maxDepth+1) + depth] =
            new Chart(targetSize, this._rng);
    }

    initShared(from : ChartTable,
               nonTermIndex : number, depth : number) {
        assert(depth === this._currentDepth);
        const existing = this.store[nonTermIndex * (this._maxDepth+1) + depth];
        if (existing) {
            // remove the existing size from the count if we have one
            this._cumSize[nonTermIndex * (this._maxDepth+1) + depth] -= existing.size;
        }

        const newChart = from.store[nonTermIndex * (this._maxDepth+1) + depth];
        assert(newChart);
        this.store[nonTermIndex * (this._maxDepth+1) + depth] = newChart;
        // add the new chart to the cumsum
        this._cumSize[nonTermIndex * (this._maxDepth+1) + depth] += newChart.size;
    }

    increaseDepth() {
        this._currentDepth ++;
        if (this._currentDepth === 0)
            return;
        assert(this._currentDepth <= this._maxDepth);

        // init the cumsum array at the current depth with the cumsum
        // element at the previous depth
        for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++) {
            this._cumSize[nonTermIndex * (this._maxDepth+1) + this._currentDepth] =
                this._cumSize[nonTermIndex * (this._maxDepth+1) + this._currentDepth-1];
        }
    }

    private _getChart(nonTermIndex : number, depth : number) {
        assert(nonTermIndex <= this._nonTermList.length);
        assert(depth <= this._maxDepth);
        return this.store[nonTermIndex * (this._maxDepth+1) + depth]!;
    }

    reset(nonTermIndex : number, depth : number) {
        this._getChart(nonTermIndex, depth).reset();
    }

    getSizeAtDepth(nonTermIndex : number, depth : number) {
        const ret = this._getChart(nonTermIndex, depth).size;
        //console.log(`getSizeAtDepth(${this._nonTermList[nonTermIndex]}, ${depth}) = ${ret}`);
        return ret;
    }

    getSizeUpToDepth(nonTermIndex : number, upToDepth : number) {
        assert(nonTermIndex <= this._nonTermList.length);
        assert(upToDepth <= this._maxDepth);
        return this._cumSize[nonTermIndex * (this._maxDepth+1) + upToDepth];
    }

    getAtDepth(nonTermIndex : number, depth : number) : Iterable<Derivation<any>> {
        return this._getChart(nonTermIndex, depth);
    }

    *getUpToDepth(nonTermIndex : number, upToDepth : number) : Iterable<Derivation<any>> {
        for (let depth = 0; depth <= upToDepth; depth++)
            yield* this._getChart(nonTermIndex, depth);
    }

    getAtDepthForKey(nonTermIndex : number, depth : number,
                     indexName : string, key : DerivationKeyValue) : Iterable<Derivation<any>> {
        return this._getChart(nonTermIndex, depth).forKey(indexName, key);
    }

    *getUpToDepthForKey(nonTermIndex : number, upToDepth : number,
                        indexName : string, key : DerivationKeyValue) : Iterable<Derivation<any>> {
        for (let depth = 0; depth <= upToDepth; depth++)
            yield* this._getChart(nonTermIndex, depth).forKey(indexName, key);
    }

    chooseAtDepth(nonTermIndex : number, depth : number) : Derivation<any>|undefined {
        return this._getChart(nonTermIndex, depth).choose();
    }

    chooseAtDepthForKey(nonTermIndex : number, depth : number,
                        indexName : string, key : DerivationKeyValue) : Derivation<any>|undefined {
        return this._getChart(nonTermIndex, depth).chooseForKey(indexName, key);
    }

    chooseUpToDepth(nonTermIndex : number, upToDepth : number) : Derivation<any>|undefined {
        const depthSizes = this._cumSize.slice(nonTermIndex * (this._maxDepth+1),
                                               nonTermIndex * (this._maxDepth+1) + (upToDepth+1));
        assert(depthSizes.length === upToDepth+1);
        if (depthSizes[upToDepth] === 0)
            return undefined;
        const chosenDepth = categoricalPrecomputed(depthSizes, depthSizes.length, this._rng);
        return this.chooseAtDepth(nonTermIndex, chosenDepth);
    }

    chooseUpToDepthForKey(nonTermIndex : number, upToDepth : number,
                          indexName : string, key : DerivationKeyValue) : Derivation<any>|undefined {
        const cumDepthSizes : number[] = [];
        const subcharts = [];

        for (let depth = 0; depth <= upToDepth; depth++) {
            const chart = this._getChart(nonTermIndex, depth);
            const forKey = chart.forKey(indexName, key);
            cumDepthSizes.push(depth === 0 ? forKey.length : cumDepthSizes[depth-1] + forKey.length);
            subcharts.push(forKey);
        }
        assert(cumDepthSizes.length === upToDepth+1);
        if (cumDepthSizes[upToDepth] === 0)
            return undefined;

        const chosenDepth = categoricalPrecomputed(cumDepthSizes, cumDepthSizes.length, this._rng);
        assert(subcharts[chosenDepth].length > 0);
        return uniform(subcharts[chosenDepth], this._rng);
    }

    add(nonTermIndex : number, depth : number, derivation : Derivation<any>) {
        //console.log(`add(${this._nonTermList[nonTermIndex]}, ${depth})`);
        assert(depth === this._currentDepth);
        this._currentDepth = depth;

        const added = this._getChart(nonTermIndex, depth).add(derivation);
        if (added)
            this._cumSize[nonTermIndex * (this._maxDepth+1) + depth]++;
    }
}

const INFINITY = 1<<30; // integer infinity

/**
 * Low-level class that generates sentences and associated logical forms,
 * given a grammar expressed as Genie template files.
 */
export default class SentenceGenerator<ContextType, StateType, RootOutputType = StateType> extends events.EventEmitter {
    private _templateFiles : string[];
    private _langPack : I18n.LanguagePack;

    private _options : SentenceGeneratorOptions<ContextType, StateType>;
    private _contextual : boolean;

    private _nonTermTable : Map<string, number>;
    private _nonTermList : string[];
    private _rules : Array<Array<Rule<any[], any>>>;
    private _contextTable : Record<string, number>;
    private _functionTable : FunctionTable<StateType>;

    private _rootSymbol : string;
    private _rootIndex : number;

    private _contextInitializer : ContextInitializer<ContextType, StateType>|undefined;

    private _constantMap : MultiMap<string, number>;

    private _finalized : boolean;
    private _averagePruningFactor : number[][];
    private _minDistanceFromRoot : number[];
    private _nonTermHasContext : boolean[];

    private _charts : ChartTable|undefined;

    private _progress : number;

    constructor(options : SentenceGeneratorOptions<ContextType, StateType>) {
        super();

        this._templateFiles = options.templateFiles;
        this._langPack = I18n.get(options.locale);

        this._options = options;
        this._contextual = options.contextual;

        this._nonTermTable = new Map;
        this._nonTermList = [];
        this._rules = [];

        this._contextTable = {};
        this._functionTable = {};

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
        return Object.prototype.hasOwnProperty.call(this._contextTable, symbol);
    }

    get contextTable() : ContextTable {
        return this._contextTable;
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
        if (Object.prototype.hasOwnProperty.call(this._functionTable, name))
            throw new GenieTypeError(`Function ${name} already declared`);
        this._functionTable[name] = fn;
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
        this._contextTable[context] = index;
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
        for (const constant of ThingTalkUtils.createConstants(token, type, this._options.maxConstants || DEFAULT_MAX_CONSTANTS)) {
            const sentencepiece = constant.display;
            const combiner = () => new Derivation({}, constant.value, List.singleton(sentencepiece), null, attributes.priority || 0);
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
        if (this._contextual && !this._functionTable.context)
            throw new GenieTypeError(`Missing "context" function for contextual grammar`);

        for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++) {
            const nonTerm = this._nonTermList[nonTermIndex];
            const rules = this._rules[nonTermIndex];

            for (const rule of rules) {
                for (const expansion of rule.expansion) {
                    if (expansion instanceof NonTerminal) {
                        const index = this._nonTermTable.get(expansion.symbol);
                        if (index === undefined)
                            throw new Error(`Non-terminal ${expansion.symbol} undefined, referenced by ${nonTerm}`);
                        expansion.index = index;
                    }
                }
            }
        }
    }

    private _computeHasContext() {
        // iterate until convergence

        this._nonTermHasContext = [];
        for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++)
            this._nonTermHasContext.push(false);

        for (const index of Object.values(this._contextTable))
            this._nonTermHasContext[index] = true;

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

                    for (const expansion of rule.expansion) {
                        if (expansion instanceof NonTerminal && this._nonTermHasContext[expansion.index]) {
                            rule.hasContext = true;
                            break;
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
            this._minDistanceFromRoot.push(INFINITY);
        assert(this._nonTermList.length === this._minDistanceFromRoot.length);

        const queue : Array<[number, number]> = [];
        for (const index of Object.values(this._contextTable))
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

    private _estimateDepthSize(charts : ChartTable, depth : number, firstGeneration : boolean) : [number, number[][]] {
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
                let { estimatedGenSize, } = estimateRuleSize(charts, depth, index, rule, this._averagePruningFactor);

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

    private _disableUnreachableRules(charts : ChartTable) : void {
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

                    let good = true;
                    for (const expansion of rule.expansion) {
                        if (expansion instanceof NonTerminal && this.hasContext(expansion.symbol)) {
                            // this terminal is a context
                            // disable the rule if the context is empty
                            if (charts.getSizeAtDepth(expansion.index, 0) === 0) {
                                good = false;
                                break;
                            }
                        }
                    }

                    if (good) {
                        // all contexts are non-empty, or we don't have a context at all
                        // enable this rule
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

    invokeFunction<K extends keyof FunctionTable<StateType>>(name : K, ...args : Parameters<NonNullable<FunctionTable<StateType>[K]>>) : ReturnType<NonNullable<FunctionTable<StateType>[K]>> {
        //if (!this._functionTable.has(name))
        //    return null;
        return this._functionTable[name]!(...args);
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
                    const combiner = () => new Derivation({}, constant.value, List.singleton(constant.display), null, attributes.priority);
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

        const charts : ChartTable = new ChartTable(this._nonTermList,
                                                   this._options.maxDepth,
                                                   this._options.rng);

        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            if (this._options.debug >= LogLevel.INFO)
                console.log(`--- DEPTH ${depth}`);
            const depthbegin = Date.now();

            const targetPruningSize = Math.ceil(this._options.targetPruningSize * POWERS[depth]);
            charts.increaseDepth();
            for (let index = 0; index < this._nonTermList.length; index++)
                charts.init(index, depth, INFINITY);

            if (this._contextual && depth === 0) {
                this._initializeContexts([context], charts);
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
                        expandRule(charts, depth, index, rule, this._averagePruningFactor, INFINITY, this._options, this._nonTermList, (derivation) => {
                            if (derivation === null)
                                return;
                            queue.push(derivation);
                        });
                    } catch(e) {
                        console.error(`Error expanding rule NT[${this._nonTermList[index]}] -> ${rule.expansion.join(' ')}`);
                        throw e;
                    }
                }

                const initialSize = charts.getSizeAtDepth(index, depth);
                nonTermSize = Math.min(queue.size, targetPruningSize);
                for (let i = 0; i < nonTermSize; i++) {
                    const derivation = queue.pop();
                    assert(derivation);
                    if (isRoot)
                        rootSampler.push(derivation);
                    else
                        charts.add(index, depth, derivation);
                }
                nonTermSize += initialSize;
                assert(isRoot || charts.getSizeAtDepth(index, depth) === nonTermSize);
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
    private _initializeContexts(contextInputs : readonly ContextType[],
                                charts : ChartTable) : void {
        for (const ctxIn of contextInputs) {
            try {
                const result = this._contextInitializer!(ctxIn, this._functionTable, this._contextTable);
                if (result !== null) {
                    const ctx = new Context(ctxIn);
                    for (const phrase of result) {
                        const index = phrase.symbol;
                        assert(index >= 0 && index <= this._nonTermTable.size, `Invalid context number ${index}`);
                        const sentence = phrase.utterance ? List.singleton(phrase.utterance) : List.Nil;
                        const derivation = new Derivation({}, phrase.value, sentence, ctx, phrase.priority || 0);
                        charts.add(index, 0, derivation);
                    }
                }
            } catch(e) {
                console.error(ctxIn);
                throw e;
            }
        }
    }

    /**
     * Generate a batch of sentences (or dialogue turns), given the batch of contexts.
     *
     * This method is optimized for batch generation, and will cache intermediate generations
     * that do not depend on the context between subsequent calls.
     */
    generate(contextInputs : readonly ContextType[],
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
            if (!this._charts) {
                this._charts = new ChartTable(this._nonTermList,
                                              this._options.maxDepth,
                                              this._options.rng);
                for (let depth = 0; depth <= this._options.maxDepth; depth++) {
                    this._charts.increaseDepth();

                    // multiply non-contextual non-terminals by a factor
                    const targetPruningSize = NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER * this._options.targetPruningSize * POWERS[depth];
                    for (let index = 0; index < this._nonTermList.length; index++) {
                        if (!this._nonTermHasContext[index])
                            this._charts.init(index, depth, Math.ceil(targetPruningSize));
                    }
                }

                firstGeneration = true;
            } else {
                firstGeneration = false;
            }
        }

        const charts : ChartTable = new ChartTable(this._nonTermList,
                                                   this._options.maxDepth,
                                                   this._options.rng);
        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            if (this._options.debug >= LogLevel.INFO)
                console.log(`--- DEPTH ${depth}`);
            const depthbegin = Date.now();

            charts.increaseDepth();
            const targetPruningSize = this._options.targetPruningSize * POWERS[depth];
            for (let index = 0; index < this._nonTermList.length; index++) {
                // use the shared chart if we can, otherwise make a fresh one

                // the chart for context symbols is never pruned, so we set size
                // to a large number (integer, to avoid floating point computations)
                if (this._contextual && depth === 0 && this.hasContext(this._nonTermList[index]))
                    charts.init(index, depth, INFINITY);
                else if (!this._contextual || this._nonTermHasContext[index])
                    charts.init(index, depth, Math.ceil(targetPruningSize));
                else
                    charts.initShared(this._charts!, index, depth);
            }

            if (this._contextual && depth === 0)
                this._initializeContexts(contextInputs, charts);

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
                        const array = Array.from(sampler);
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
                        charts.add(index, depth, derivation);
                }
                nonTermSize = charts.getSizeAtDepth(index, depth);
                if (isRoot) {
                    for (const derivation of charts.getAtDepth(index, depth))
                        callback(depth, derivation);

                    charts.reset(index, depth);
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

function computeWorstCaseGenSize(charts : ChartTable,
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
    for (let pivotIdx = 0; pivotIdx < expansion.length; pivotIdx++) {
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
            if (k === pivotIdx) {
                if (currentExpansion instanceof NonTerminal)
                    tmp *= charts.getSizeAtDepth(currentExpansion.index, fixeddepth);
                else
                    tmp = 0;
            } else if (currentExpansion instanceof NonTerminal) {
                tmp *= charts.getSizeUpToDepth(currentExpansion.index,
                                               k > pivotIdx ? maxdepth : maxdepth-1);
            }
        }

        worstCaseGenSize += tmp;
    }

    return worstCaseGenSize;
}

interface RuleSizeEstimate {
    worstCaseGenSize : number;
    reducedWorstCaseGenSize : number;
    maxdepth : number;
    estimatedGenSize : number;
    estimatedPruneFactor : number;
}

function estimateRuleSize(charts : ChartTable,
                          depth : number,
                          nonTermIndex : number,
                          rule : Rule<unknown[], unknown>,
                          averagePruningFactor : number[][]) : RuleSizeEstimate {
    // first compute how many things we expect to produce in the worst case
    let maxdepth = depth-1;
    const worstCaseGenSize = computeWorstCaseGenSize(charts, depth, rule, maxdepth);
    if (worstCaseGenSize === 0)
        return { maxdepth, worstCaseGenSize: 0, reducedWorstCaseGenSize: 0, estimatedGenSize: 0, estimatedPruneFactor: 1 };

    // prevent exponential behavior!
    let reducedWorstCaseGenSize = worstCaseGenSize;
    while (reducedWorstCaseGenSize >= EXPONENTIAL_PRUNE_SIZE && maxdepth >= 0) {
        maxdepth--;
        reducedWorstCaseGenSize = computeWorstCaseGenSize(charts, depth, rule, maxdepth);
    }
    if (maxdepth < 0 || reducedWorstCaseGenSize === 0)
        return { maxdepth, worstCaseGenSize, reducedWorstCaseGenSize, estimatedGenSize: 0, estimatedPruneFactor: 1 };

    const estimatedPruneFactor = averagePruningFactor[nonTermIndex][rule.number];
    const estimatedGenSize = worstCaseGenSize * estimatedPruneFactor;
    return { maxdepth, worstCaseGenSize, reducedWorstCaseGenSize, estimatedGenSize, estimatedPruneFactor } ;
}

interface ExpandOptions {
    debug : number;
    rng : () => number;
}

type DerivationChildOrChoice = DerivationChild<any> | Choice;

function assignChoices(choices : DerivationChildOrChoice[], rng : () => number) : Array<DerivationChild<any>> {
    return choices.map((c) => c instanceof Choice ? c.choose(rng) : c);
}

function getKeyConstraint(choices : DerivationChildOrChoice[],
                          nonTerm : NonTerminal) : [string, DerivationKeyValue]|null {
    if (nonTerm.relativeKeyConstraint) {
        const [ourIndexName, otherNonTerminal, otherIndexName] = nonTerm.relativeKeyConstraint;
        const otherChoice = choices[otherNonTerminal];
        assert(otherChoice instanceof Derivation);
        const keyValue = otherChoice.key[otherIndexName];
        return [ourIndexName, keyValue];
    } else if (nonTerm.constantKeyConstraint) {
        return nonTerm.constantKeyConstraint;
    } else {
        return null;
    }
}

function expandRuleExhaustive(charts : ChartTable,
                              depth : number,
                              maxdepth : number,
                              basicCoinProbability : number,
                              nonTermIndex : number,
                              rule : Rule<any[], any>,
                              sizeEstimate : RuleSizeEstimate,
                              targetPruningSize : number,
                              options : ExpandOptions,
                              nonTermList : string[],
                              emit : (value : Derivation<any>) => void) : [number, number] {
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

    // to avoid hitting exponential behavior too often, we tweak the above
    // algorithm to not go above maxdepth for all but one non-terminal,
    // and then cycle through which non-terminal is allowed to grow

    const rng = options.rng;
    const expansion = rule.expansion;
    const combiner = rule.combiner;

    if (maxdepth < depth-1 && options.debug >= LogLevel.INFO)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : reduced max depth to avoid exponential behavior`);

    if (options.debug >= LogLevel.EVERYTHING)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : worst case ${sizeEstimate.worstCaseGenSize}, expect ${Math.round(sizeEstimate.estimatedGenSize)}`);

    const estimatedPruneFactor = sizeEstimate.estimatedPruneFactor;
    const choices : DerivationChildOrChoice[] = [];
    // fill and size the array
    for (let i = 0; i < expansion.length; i++)
        choices.push('');
    let actualGenSize = 0;
    let prunedGenSize = 0;
    let coinProbability = basicCoinProbability;
    for (let pivotIdx = 0; pivotIdx < expansion.length; pivotIdx++) {
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
            if (currentExpansion instanceof NonTerminal) {
                let candidates;
                const constraint = getKeyConstraint(choices, currentExpansion);
                if (k === pivotIdx) {
                    if (constraint) {
                        const [indexName, keyValue] = constraint;
                        candidates = charts.getAtDepthForKey(currentExpansion.index,
                                                             fixeddepth,
                                                             indexName, keyValue);
                    } else {
                        candidates = charts.getAtDepth(currentExpansion.index, fixeddepth);
                    }
                } else {
                    if (constraint) {
                        const [indexName, keyValue] = constraint;
                        candidates = charts.getUpToDepthForKey(currentExpansion.index,
                                                               k > pivotIdx ? maxdepth : maxdepth-1,
                                                               indexName, keyValue);
                    } else {
                        candidates = charts.getUpToDepth(currentExpansion.index,
                                                         k > pivotIdx ? maxdepth : maxdepth-1);
                    }
                }

                for (const candidate of candidates) {
                    if (!Context.compatible(context, candidate.context))
                        continue;
                    const newContext = Context.meet(context, candidate.context);
                    if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                        continue;
                    choices[k] = candidate;
                    //depths[k] = fixeddepth;
                    recursiveHelper(k+1, newContext);
                }
            } else {
                if (k !== pivotIdx) {
                    choices[k] = currentExpansion;
                    recursiveHelper(k+1, context);
                }
            }
        })(0, null);
    }

    return [actualGenSize, prunedGenSize];
}

function expandRuleSample(charts : ChartTable,
                          depth : number,
                          nonTermIndex : number,
                          rule : Rule<any[], any>,
                          sizeEstimate : RuleSizeEstimate,
                          targetSemanticFunctionCalls : number,
                          targetPruningSize : number,
                          options : ExpandOptions,
                          nonTermList : string[],
                          emit : (value : Derivation<any>) => void) : [number, number] {
    const rng = options.rng;
    const expansion = rule.expansion;
    const combiner = rule.combiner;

    // this is an approximate, sampling-based version of the above algorithm,
    // which does not require enumerating anything

    assert(depth > 0);

    const expansionLenght = expansion.length;

    // we take N samples from all the possible enumerations
    //
    // a valid sample must contain at least one derivation from depth = D-1
    // so we first choose which non-terminal will be the D-1, which we
    // call the pivot element
    // then we sample one derivation from each non-terminal to the left of the
    // pivot, from depth <= D-2
    // and one derivation from each non-terminal to the right of the pivot,
    // from depth <= D-1

    // the tricky part is how to sample precisely, without making a copy of all
    // charts at depth <= D-2
    // to do so, we precompute a lot of cumsums and then sample categorically
    // from them

    // first we get rid of the depth === 1 case, where we must sample from
    // depth == 0 and the pivot business does not make sense
    if (depth === 1) {
        let actualGenSize = 0, prunedGenSize = 0;
        const choices : Array<DerivationChild<any>> = [];
        // fill and size the array
        for (let i = 0; i < expansionLenght; i++)
            choices.push('');

        outerloop:
        for (let sampleIdx = 0; sampleIdx < targetSemanticFunctionCalls; sampleIdx++) {
            for (let i = 0; i < expansionLenght; i++) {
                const currentExpansion = expansion[i];
                if (currentExpansion instanceof NonTerminal) {
                    // apply the key constraint if we have it
                    const constraint = getKeyConstraint(choices, currentExpansion);
                    let choice;
                    if (constraint) {
                        const [indexName, keyValue] = constraint;
                        choice = charts.chooseAtDepthForKey(currentExpansion.index, 0, indexName, keyValue);
                    } else {
                        choice = charts.chooseAtDepth(currentExpansion.index, 0);
                    }
                    if (!choice) // no compatible derivation with these keys
                        continue outerloop;
                    choices[i] = choice;
                } else {
                    choices[i] = currentExpansion instanceof Choice ? currentExpansion.choose(rng) : currentExpansion;
                }
            }

            const v = combiner(choices, rule.priority);
            if (v !== null) {
                actualGenSize ++;
                emit(v);
            } else {
                prunedGenSize ++;
            }
        }

        return [actualGenSize, prunedGenSize];
    }

    // now do the actual pivot dance

    // the probability of being pivot is the number of expansions
    // that this non-terminal would be pivot for
    //
    // which compute that as the total number of expansions to the
    // left, aka the cumprod of the total size up to depth-2 of <i
    // times the depth-1 size of the current non terminal
    // times the total number of expansions to the right
    // aka the cumprod of the total size up to depth-1 of >i

    const leftCumProd : number[] = [];
    for (let i = 0; i < expansionLenght; i++) {
        const exp = expansion[i];
        if (exp instanceof NonTerminal) {
            if (i === 0)
                leftCumProd.push(charts.getSizeUpToDepth(exp.index, depth-2));
            else
                leftCumProd.push(leftCumProd[i-1] * charts.getSizeUpToDepth(exp.index, depth-2));
        } else {
            if (i === 0)
                leftCumProd.push(1);
            else
                leftCumProd.push(leftCumProd[i-1]);
        }
    }
    const rightCumProd : number[] = [];
    // for efficiency, we need to ensure rightCumProd is a packed array
    // but we want to fill it from the end, so we first fill it with 0
    for (let i = 0; i < expansionLenght; i++)
        rightCumProd[i] = 0;
    for (let i = expansionLenght-1; i >= 0; i--) {
        const exp = expansion[i];
        if (exp instanceof NonTerminal) {
            if (i === expansionLenght-1)
                rightCumProd[i] = charts.getSizeUpToDepth(exp.index, depth-1);
            else
                rightCumProd[i] = rightCumProd[i+1] * charts.getSizeUpToDepth(exp.index, depth-1);
        } else {
            if (i === expansionLenght-1)
                rightCumProd[i] = 1;
            else
                rightCumProd[i] = rightCumProd[i+1];
        }
    }

    // compute the probability that an element is a pivot
    const pivotProbabilityCumsum : number[] = [];

    for (let i = 0; i < expansionLenght; i++) {
        const currentExpansion = expansion[i];
        if (currentExpansion instanceof NonTerminal) {
            const left = i > 0 ? leftCumProd[i-1] : 1;
            const right = i < expansionLenght-1 ? rightCumProd[i+1] : 1;
            const self = charts.getSizeAtDepth(currentExpansion.index, depth-1);
            const pivotProbability = left * self * right;

            if (i === 0)
                pivotProbabilityCumsum.push(pivotProbability);
            else
                pivotProbabilityCumsum.push(pivotProbabilityCumsum[i-1] + pivotProbability);
        } else {
            // a terminal token can never be the pivot (because it only gets
            // generated at depth 0)
            if (i === 0)
                pivotProbabilityCumsum.push(0);
            else
                pivotProbabilityCumsum.push(pivotProbabilityCumsum[i-1]);
        }
    }

    // now make the samples
    let actualGenSize = 0, prunedGenSize = 0;
    const choices : Array<DerivationChild<any>> = new Array<DerivationChild<any>>(expansion.length);
    // fill and size the array
    for (let i = 0; i < expansionLenght; i++)
        choices.push('');
    let newContext : Context|null = null;

    outerloop:
    for (let sampleIdx = 0; sampleIdx < targetSemanticFunctionCalls; sampleIdx++) {
        newContext = null;

        // choose the pivot
        const pivotIdx = categoricalPrecomputed(pivotProbabilityCumsum, pivotProbabilityCumsum.length, rng);

        for (let i = 0; i < expansionLenght; i++) {
            const currentExpansion = expansion[i];
            if (i === pivotIdx) {
                if (!(currentExpansion instanceof NonTerminal))
                    continue outerloop;

                // apply the key constraint if we have it
                const constraint = getKeyConstraint(choices, currentExpansion);
                let choice;
                if (constraint) {
                    const [indexName, keyValue] = constraint;
                    choice = charts.chooseAtDepthForKey(currentExpansion.index, depth-1,
                                                        indexName, keyValue);
                } else {
                    choice = charts.chooseAtDepth(currentExpansion.index, depth-1);
                }

                if (!choice && !constraint) {
                    // uh oh!
                    console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')}`);
                    console.log(`pivotIdx = ${pivotIdx}`);
                    console.log(`leftCumProd =`, leftCumProd);
                    console.log(`rightCumProd =`, rightCumProd);
                    console.log(`pivotProbabilityCumsum =`, pivotProbabilityCumsum);
                    throw new Error(`Unexpected empty chart for pivot`);
                }
                if (!choice) // no compatible derivation with these keys
                    continue outerloop;
                choices[i] = choice;
            } else {
                if (currentExpansion instanceof NonTerminal) {
                    const maxdepth = i < pivotIdx ? depth-2 : depth-1;

                    const constraint = getKeyConstraint(choices, currentExpansion);
                    let choice;
                    if (constraint) {
                        const [indexName, keyValue] = constraint;
                        choice = charts.chooseUpToDepthForKey(currentExpansion.index, maxdepth,
                                                              indexName, keyValue);
                    } else {
                        choice = charts.chooseUpToDepth(currentExpansion.index, maxdepth);
                    }
                    if (!choice && !constraint) {
                        // uh oh!
                        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')}`);
                        console.log(`pivotIdx = ${pivotIdx}`);
                        console.log(`currentIdx = ${i}`);
                        console.log(`maxdepth = ${maxdepth}`);
                        console.log(`leftCumProd =`, leftCumProd);
                        console.log(`rightCumProd =`, rightCumProd);
                        console.log(`pivotProbabilityCumsum =`, pivotProbabilityCumsum);
                        throw new Error(`Unexpected empty chart for non-pivot`);
                    }
                    if (!choice) // no compatible derivation with these keys
                        continue outerloop;
                    choices[i] = choice;
                } else {
                    choices[i] = currentExpansion instanceof Choice ? currentExpansion.choose(rng) : currentExpansion;
                }
            }

            const chosen = choices[i];
            if (chosen instanceof Context) {
                if (!Context.compatible(newContext, chosen))
                    continue outerloop;
                newContext = chosen;
            } else if (chosen instanceof Derivation) {
                if (!Context.compatible(newContext, chosen.context))
                    continue outerloop;
                newContext = Context.meet(newContext, chosen.context);
                if (combiner.isReplacePlaceholder && i === 0 && !chosen.hasPlaceholders())
                    continue outerloop;
            }
        }

        const v = combiner(choices, rule.priority);
        if (v !== null) {
            actualGenSize ++;
            emit(v);
        } else {
            prunedGenSize ++;
        }
    }

    return [actualGenSize, prunedGenSize];
}

function expandRule(charts : ChartTable,
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

    const sizeEstimate =
        estimateRuleSize(charts, depth, nonTermIndex, rule, averagePruningFactor);
    const { maxdepth, worstCaseGenSize, estimatedGenSize, estimatedPruneFactor } = sizeEstimate;

    if (options.debug >= LogLevel.EVERYTHING)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : worst case estimate ${worstCaseGenSize}`);
    if (worstCaseGenSize === 0)
        return;

    const now = Date.now();

    // to avoid spending too much time calling the combiner for things we'll prune later,
    // we randomly sample out of all possible combinations about as many as we estimate
    // we'll need to fill the reservoir
    const coinProbability = Math.min(1, targetPruningSize / estimatedGenSize);

    // make an estimate of the number of times we'll need to call the semantic function
    // to get the target pruning size
    const targetSemanticFunctionCalls = Math.min(targetPruningSize / estimatedPruneFactor, EXPONENTIAL_PRUNE_SIZE);

    //console.log('expand $' + nonterminal + ' -> ' + expansion.join('') + ' : actual ' + actualGenSize);

    let actualGenSize, prunedGenSize;
    let strategy;
    if (sizeEstimate.maxdepth === depth-1 && (coinProbability >= 1 || targetSemanticFunctionCalls >= worstCaseGenSize * 0.8)) {
        if (options.debug >= LogLevel.EVERYTHING)
            console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : using recursive expansion`);

        // use the exhaustive algorithm if we expect to we'll be close to exhaustive anyway
        [actualGenSize, prunedGenSize] = expandRuleExhaustive(charts, depth, maxdepth, coinProbability,
            nonTermIndex, rule, sizeEstimate, targetPruningSize,
            options, nonTermList, emit);
        strategy = 'enumeration';
    } else {
        if (options.debug >= LogLevel.EVERYTHING)
            console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : using sampling`);

        // otherwise use the imprecise but faster sampling algorithm
        [actualGenSize, prunedGenSize] = expandRuleSample(charts, depth,
            nonTermIndex, rule, sizeEstimate, targetSemanticFunctionCalls, targetPruningSize,
            options, nonTermList, emit);
        strategy = 'sampling';
    }

    if (actualGenSize + prunedGenSize === 0)
        return;
    const newEstimatedPruneFactor = actualGenSize / (actualGenSize + prunedGenSize);
    if (options.debug >= LogLevel.VERBOSE_GENERATION && newEstimatedPruneFactor < 0.2)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : semantic function only accepted ${(newEstimatedPruneFactor*100).toFixed(1)}% of derivations`);

    const elapsed = Date.now() - now;
    if (options.debug >= LogLevel.INFO && elapsed >= 10000)
        console.log(`expand NT[${nonTermList[nonTermIndex]}] -> ${expansion.join(' ')} : took ${(elapsed/1000).toFixed(2)} seconds using ${strategy}`);

    const movingAverageOfPruneFactor = (0.01 * estimatedPruneFactor + newEstimatedPruneFactor) / (1.01);
    averagePruningFactor[nonTermIndex][rule.number] = movingAverageOfPruneFactor;
}
