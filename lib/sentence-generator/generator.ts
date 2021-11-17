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
import * as ThingTalk from 'thingtalk';

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
import {
    Replaceable,
    ReplacedPhrase,
    ReplacedResult,
} from '../utils/template-string';

import {
    LogLevel,

    Context,
    Derivation,
    NonTerminal,
    DerivationChildTuple,
} from './runtime';
import {
    SemanticAction,
    KeyFunction,
    DerivationKeyValue,
    RuleAttributes,
    ContextPhrase,
    ContextTable,
    GrammarOptions,
} from './types';
import { importGenie } from './compiler';
import ThingpediaLoader from '../templates/load-thingpedia';

function dummyKeyFunction() {
    return {};
}

class Rule<ArgTypes extends unknown[], ReturnType> {
    readonly expansion : NonTerminal[];
    readonly sentence : Replaceable;
    readonly semanticAction : SemanticAction<ArgTypes, ReturnType>;
    readonly keyFunction : KeyFunction<ReturnType>;

    readonly weight : number;
    readonly priority : number;
    readonly forConstant : boolean;
    readonly temporary : boolean;
    readonly identity : boolean;
    readonly expandchoice : boolean;

    repeat : boolean;
    hasContext : boolean;
    enabled : boolean;
    estimatedPruningFactor : number;

    constructor(number : number,
                expansion : NonTerminal[],
                sentence : Replaceable,
                semanticAction : SemanticAction<ArgTypes, ReturnType>,
                keyFunction : KeyFunction<ReturnType> = dummyKeyFunction,
                { weight = 1, priority = 0, repeat = false, forConstant = false, temporary = false,
                  identity = false, expandchoice = true } : RuleAttributes) {
        this.expansion = expansion;
        this.sentence = sentence;
        this.semanticAction = semanticAction;
        this.keyFunction = keyFunction;

        // attributesGrammarOptions
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
        // initialize prune factor estimates to 0.2
        // so we don't start pruning until we have a good estimate
        this.estimatedPruningFactor = 0.2;
        assert(this.weight > 0);
    }

    toString() {
        return `${this.sentence} (${this.expansion.join(', ')})`;
    }

    apply(children : DerivationChildTuple<ArgTypes>, atDepth : number) : Derivation<ReturnType>|null {
        return Derivation.combine(children, this.sentence, this.semanticAction, this.keyFunction, atDepth, this.priority);
    }
}

// the maximum number of distinct constants of a certain type in a program
const DEFAULT_MAX_CONSTANTS = 5;

class GenieTypeError extends Error {
}

// in contextual (dialogue) generation, non-contextual non terminals have their pruning
// size multiplied by this factor
const NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER = 3;

// powers grow by 2 until depth 5, then go down by 0.8
const POWERS = [1];
for (let i = 1; i < 6; i++)
    POWERS[i] = 2 * POWERS[i-1];
for (let i = 6; i < 20; i++)
    POWERS[i] = 0.8 * POWERS[i-1];
const EXPONENTIAL_PRUNE_SIZE = 500000000;
const SAMPLING_PRUNE_SIZE = 1000000;
const MAX_SAMPLE_SIZE = 1000000;

// the automatically added derivation key considering the context
const CONTEXT_KEY_NAME = '$context';

interface GenericSentenceGeneratorOptions extends GrammarOptions {
    locale : string;
    templateFiles ?: string[];
    rootSymbol ?: string;
    targetPruningSize : number;
    maxDepth : number;
    maxConstants : number;
    rng : () => number;
    logPrefix ?: string;
}

interface BasicSentenceGeneratorOptions {
    contextual : false;
}

interface ContextualSentenceGeneratorOptions {
    contextual : true;
    rootSymbol ?: string;
}

export type SentenceGeneratorOptions =
    GenericSentenceGeneratorOptions &
    (BasicSentenceGeneratorOptions | ContextualSentenceGeneratorOptions);

interface Constant {
    token : ReplacedResult;
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
    private readonly _store : ReservoirSampler<Derivation<any>>;

    /**
     * A map from index name to the index (hash table) mapping a certain
     * key to a list of derivations.
     */
    private readonly _indices : Record<string, DerivationIndex>;

    private readonly _rng : () => number;

    private _generated = false;

    constructor(targetSize : number, rng : () => number) {
        this._store = new ReservoirSampler(targetSize, rng);
        this._indices = {
            [CONTEXT_KEY_NAME]: new HashMultiMap<DerivationKeyValue, Derivation<any>>()
        };
        this._rng = rng;
    }

    /**
     * The number of derivations sampled in this chart.
     */
    get size() {
        return this._store.length;
    }

    /**
     * Whether this chart has been filled with content, or it's still empty.
     */
    get generated() {
        return this._generated;
    }

    /**
     * Mark that this chart was fully generated.
     */
    markGenerated() {
        this._generated = true;
    }

    /**
     * Clear this chart, removing all derivations and resetting all indices.
     *
     * This also resets the {@link generated} flag.
     */
    reset() {
        this._store.reset();
        for (const indexName in this._indices)
            this._indices[indexName].clear();
        this._generated = false;
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
        assert(key !== undefined);
        const map = this._indices[indexName];
        if (!map)
            return [];
        return map.get(key);
    }

    /**
     * Sample a single random derivation.
     *
     * @returns a derivation, or `undefined` if the chart is empty
     */
    choose() : Derivation<any>|undefined {
        if (this._store.length === 0)
            return undefined;
        return uniform(this._store.sampled, this._rng);
    }

    /**
     * Sample a single random derivation compatible with the given key.
     *
     * @returns a derivation, or `undefined` if the chart is empty or all derivations are incompatible
     */
    chooseForKey(indexName : string, key : DerivationKeyValue) : Derivation<any>|undefined {
        assert(key !== undefined);
        const map = this._indices[indexName];
        if (!map)
            return undefined;
        const samples = map.get(key);
        if (!samples.length)
            return undefined;
        return uniform(samples, this._rng);
    }

    /**
     * Add a new derivation to this chart.
     *
     * @param derivation the derivation to add
     * @returns whether the size of the chart increased or not
     */
    add(derivation : Derivation<any>) {
        const sizeBefore = this.size;

        const dropped = this._store.add(derivation);
        let added = false;
        if (dropped !== derivation) {
            // we maybe dropped one, and we definitely added derivation

            if (dropped !== undefined) {
                for (const indexName in dropped.key)
                    this._indices[indexName].deleteValue(dropped.key[indexName], dropped);
                this._indices[CONTEXT_KEY_NAME].deleteValue(dropped.context, dropped);
            } else {
                added = true;
            }

            for (const indexName in derivation.key) {
                let index = this._indices[indexName];
                if (!index)
                    this._indices[indexName] = index = new HashMultiMap<DerivationKeyValue, Derivation<any>>();

                const keyValue = derivation.key[indexName];
                assert(keyValue !== undefined);
                index.put(keyValue, derivation);
            }
            this._indices[CONTEXT_KEY_NAME].put(derivation.context, derivation);
        }

        assert.strictEqual(this.size, sizeBefore + +added);
        return added;
    }
}

enum GenerationMode {
    RANDOM,
    BY_PRIORITY
}

/**
 * All the {@link Chart}s.
 *
 * This object stores all the intermediate derivations generated up to a certain
 * point of the algorithm.
 *
 * This is semantically a 2D array indexed by non-terminal and depth, but it
 * also keeps track of cumulative sizes.
 */
class ChartTable {
    private store : Array<Chart|undefined>; // indexed by non-terminal first and depth second
    private _cumSize : number[]; // indexed by non-terminal first and depth second
    private _maxDepth : number;
    private _nonTermList : string[];

    private _rng : () => number;

    constructor(nonTermList : string[],
                maxDepth : number,
                rng : () => number) {
        this.store = [];
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
        this.store[nonTermIndex * (this._maxDepth+1) + depth] =
            new Chart(targetSize, this._rng);
    }

    private _getChart(nonTermIndex : number, depth : number) {
        assert(nonTermIndex >= 0 && nonTermIndex <= this._nonTermList.length);
        assert(depth >= 0 && depth <= this._maxDepth);
        return this.store[nonTermIndex * (this._maxDepth+1) + depth]!;
    }

    private _getCumSize(nonTermIndex : number, depth : number) {
        return this._cumSize[nonTermIndex * (this._maxDepth+1) + depth];
    }
    private _increaseCumSize(nonTermIndex : number, depth : number, delta : number) {
        assert(Number.isFinite(delta));
        this._cumSize[nonTermIndex * (this._maxDepth+1) + depth] += delta;
    }

    /**
     * Whether the chart identified by the given non-terminal, depth pair
     * was filled before.
     *
     * @param nonTermIndex the index of the non-terminal referring to this chart
     * @param depth the depth of the chart
     * @returns
     */
    isChartGenerated(nonTermIndex : number, depth : number) {
        return this._getChart(nonTermIndex, depth).generated;
    }

    /**
     * Mark that this chart was generated.
     *
     * This must be called after a chart is generated, to update the internal
     * size accounting.
     *
     * @param nonTermIndex the index of the non-terminal referring to this chart
     * @param depth the depth of the chart
     */
    markGenerated(nonTermIndex : number, depth : number) {
        const chart = this._getChart(nonTermIndex, depth);

        chart.markGenerated();
        const size = chart.size;

        // update the cumsum array at higher depths with the result of the generation
        for (let greaterDepth = depth + 1; greaterDepth <= this._maxDepth; greaterDepth++)
            this._increaseCumSize(nonTermIndex, greaterDepth, size);
    }

    /**
     * Clear the chart identified by the given non-terminal, depth pair.
     *
     * This also resets the generated flag.
     *
     * @param nonTermIndex the index of the non-terminal referring to this chart
     * @param depth the depth of the chart
     */
    reset(nonTermIndex : number, depth : number) {
        const chart = this._getChart(nonTermIndex, depth);
        const size = chart.size;
        chart.reset();
        assert.strictEqual(chart.size, 0);

        // update the cumsum array at higher depths to account for the removal
        for (let greaterDepth = depth + 1; greaterDepth <= this._maxDepth; greaterDepth++)
            this._increaseCumSize(nonTermIndex, greaterDepth, -size);
    }

    getSizeAtDepth(nonTermIndex : number, depth : number) {
        const ret = this._getChart(nonTermIndex, depth).size;
        //generator.log(`getSizeAtDepth(${this._nonTermList[nonTermIndex]}, ${depth}) = ${ret}`);
        return ret;
    }

    getSizeUpToDepth(nonTermIndex : number, upToDepth : number) {
        assert(nonTermIndex >= 0 && nonTermIndex <= this._nonTermList.length);
        assert(upToDepth <= this._maxDepth);
        if (upToDepth < 0)
            return 0;
        return this._getCumSize(nonTermIndex, upToDepth);
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
        assert(upToDepth >= 0 && upToDepth <= this._maxDepth);
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
        assert(upToDepth >= 0 && upToDepth <= this._maxDepth);
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
        const added = this._getChart(nonTermIndex, depth).add(derivation);
        if (added)
            this._increaseCumSize(nonTermIndex, depth, 1);
    }
}

const INFINITY = 1<<30; // integer infinity

/**
 * Low-level class that generates sentences and associated logical forms,
 * given a grammar expressed as Genie template files.
 */
export default class SentenceGenerator extends events.EventEmitter {
    private _templateFiles : string[];
    private _langPack : I18n.LanguagePack;
    private _entityAllocator : ThingTalk.Syntax.SequentialEntityAllocator;
    private _tpLoader : ThingpediaLoader;
    private _logPrefix : string;

    private _options : SentenceGeneratorOptions;
    private _contextual : boolean;

    private _nonTermTable : Map<string, number>;
    private _nonTermList : string[];
    private _rules : Array<Array<Rule<any[], any>>>;
    private _contextTable : Record<string, number>;

    private _constantMap : MultiMap<string, [number, KeyFunction<any>]>;

    private _finalized : boolean;
    private _nonTermHasContext : boolean[];

    private _charts : ChartTable|undefined;

    private _progress : number;

    // depth of the callstack to _ensureGenerated
    // used to debug the mutally recursive calls
    private _stackDepth = 0;

    constructor(options : SentenceGeneratorOptions) {
        super();

        this._templateFiles = options.templateFiles ?? [];
        this._langPack = I18n.get(options.locale);
        this._entityAllocator = options.entityAllocator;
        this._tpLoader = new ThingpediaLoader(this, this._langPack, options);
        this._logPrefix = options.logPrefix ?? '';

        this._options = options;
        this._contextual = options.contextual;

        this._nonTermTable = new Map;
        this._nonTermList = [];
        this._rules = [];

        this._contextTable = {};

        // map constant tokens (QUOTED_STRING, NUMBER, ...) to the non-terms where they are used (constant_String, ...)
        this._constantMap = new MultiMap;

        this._finalized = false;
        this._nonTermHasContext = [];

        this._charts = undefined;

        this._progress = 0;
    }

    get tpLoader() {
        return this._tpLoader;
    }
    get langPack() {
        return this._langPack;
    }

    /**
     * Log a debug message.
     *
     * This is a wrapper over `console.log` that includes a logging prefix
     * to disambiguate recursive calls and parallel generation.
     *
     * @param message the message to log
     * @param args additional arguments to `console.log`
     */
    log(message : string, ...args : []) {
        console.log(`${this._logPrefix}${' '.repeat(this._stackDepth)}${message}`, ...args);
    }

    async initialize() : Promise<void> {
        await this._tpLoader.init();

        for (const filename of this._templateFiles) {
            const imported = await importGenie(filename);
            await imported(this._options, this._langPack, this, this._tpLoader);
        }
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
        this._internalDeclareSymbol(symbol);
    }

    private _lookupNonTerminal(symbol : string) : number {
        const index = this._nonTermTable.get(symbol);
        if (index === undefined)
            throw new GenieTypeError(`Identifier ${symbol} is not a non-terminal`);
        return index;
    }

    private _addRuleInternal<ArgTypes extends unknown[], ResultType>(symbolId : number,
                                                                     expansion : NonTerminal[],
                                                                     sentence : Replaceable,
                                                                     semanticAction : SemanticAction<ArgTypes, ResultType>,
                                                                     keyFunction : KeyFunction<ResultType>|undefined,
                                                                     attributes : RuleAttributes = {}) {
        const rulenumber = this._rules[symbolId].length;
        const optsentence = sentence.optimize({});
        if (optsentence === null)
            return;
        this._rules[symbolId].push(new Rule(rulenumber, expansion, optsentence, semanticAction, keyFunction, attributes));
    }

    addConstants(symbol : string, token : string, type : any, keyFunction : KeyFunction<any>, attributes : RuleAttributes = {}) : void {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);

        const symbolId = this._lookupNonTerminal(symbol);
        this._constantMap.put(token, [symbolId, keyFunction]);

        attributes.forConstant = true;
        for (const constant of ThingTalkUtils.createConstants(token, type, this._options.maxConstants || DEFAULT_MAX_CONSTANTS, this._entityAllocator))
            this._addRuleInternal(symbolId, [], new ReplacedPhrase(constant.token), () => constant.value, keyFunction, attributes);
    }

    addRule<ArgTypes extends unknown[], ResultType>(symbol : string,
                                                    expansion : NonTerminal[],
                                                    sentenceTemplate : string|Replaceable,
                                                    semanticAction : SemanticAction<ArgTypes, ResultType>,
                                                    keyFunction : KeyFunction<ResultType>|undefined,
                                                    attributes : RuleAttributes = {}) : void {
        if (this._finalized)
            throw new GenieTypeError(`Grammar was finalized, cannot add more rules`);

        let sentence;
        if (typeof sentenceTemplate === 'string') {
            try {
                sentence = Replaceable.parse(sentenceTemplate).preprocess(this._langPack, expansion.map((e) => e.name ?? e.symbol));
            } catch(e) {
                throw new GenieTypeError(`Failed to parse template string for ${symbol} = ${sentenceTemplate} (${expansion.join(', ')}): ${e.message}`);
            }
        } else {
            sentence = sentenceTemplate;
        }
        this._addRuleInternal(this._lookupNonTerminal(symbol), expansion, sentence, semanticAction, keyFunction, attributes);
    }

    private _typecheck() {
        for (let nonTermIndex = 0; nonTermIndex < this._nonTermList.length; nonTermIndex++) {
            const nonTerm = this._nonTermList[nonTermIndex];
            const rules = this._rules[nonTermIndex];

            for (const rule of rules) {
                for (const expansion of rule.expansion) {
                    if (expansion instanceof NonTerminal) {
                        const index = this._nonTermTable.get(expansion.symbol);
                        if (index === undefined)
                            throw new Error(`Non-terminal ${expansion.symbol} undefined, in ${nonTerm} = ${rule}`);
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
                    this.log(`NT[${this._nonTermList[nonTermIndex]}] depends on context`);
                else
                    this.log(`NT[${this._nonTermList[nonTermIndex]}] does not depend on context`);
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

    finalize() {
        if (this._finalized)
            return;
        this._finalized = true;
        this._typecheck();

        this._addAutomaticRepeat();
        if (this._contextual)
            this._computeHasContext();

        if (this._options.debug >= LogLevel.DUMP_TEMPLATES) {
            for (let index = 0; index < this._nonTermList.length; index++) {
                for (const rule of this._rules[index])
                    this.log(`rule NT[${this._nonTermList[index]}] -> ${rule}`);
            }
        }
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
            for (const [symbolId, keyFunction] of this._constantMap.get(token)) {
                for (const constant of constants[token]) {
                    this._addRuleInternal(symbolId, [], new ReplacedPhrase(constant.token), () => constant.value, keyFunction, attributes);
                    if (this._options.debug >= LogLevel.EVERYTHING)
                        this.log(`added temporary rule NT[${this._nonTermList[symbolId]}] -> ${constant.token}`);
                }
            }
        }
    }

    private _enableAllRules() {
        for (let index = 0; index < this._nonTermList.length; index++) {
            for (const rule of this._rules[index])
                rule.enabled = true;
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
                        this.log(`disabling rule NT[${this._nonTermList[index]}] -> ${rule}`);
                }
            }
        }
    }

    /**
     * Generate a single derivation for a particular symbol in the grammar, given the single context.
     *
     * This method will expand the grammar then sample exactly one derivation out of the given non-terminal.
     *
     * This method is optimized for individual generation, and prune the set of enabled rules
     * based on the context. It cannot be called for non-contextual grammars. No `progress` events will
     * be emitted during this method.
     *
     * @param context - the current context
     * @param nonTerm - the symbol to generate
     * @return {Derivation} - the sampled derivation
     */
    generateOne(contexts : Iterable<ContextPhrase>, nonTerm : string) : Derivation<any>|undefined {
        this.finalize();
        assert(this._contextual);

        this._enableAllRules();
        this._disableRulesForConstants();

        this._initializeCharts();
        this._initializeContexts(contexts);

        const nonTermIndex = this._lookupNonTerminal(nonTerm);

        this._stackDepth = 0;
        for (let depth = 0; depth <= this._options.maxDepth; depth++)
            this._ensureGenerated(nonTermIndex, depth, GenerationMode.BY_PRIORITY);

        // find the one best derivation for this non-terminal, across all depths
        let best : Derivation<any>|undefined = undefined;
        for (const derivation of this._getAllDerivations(nonTermIndex)) {
            if (best === undefined || derivation.priority > best.priority)
                best = derivation;
        }

        this._removeTemporaryRules();

        return best;
    }

    private _getRuleTarget(rule : Rule<unknown[], unknown>,
                           nonTermIndex : number,
                           depth : number) : number {
        const nonTermHasContext = this._nonTermHasContext[nonTermIndex];
        let targetPruningSize = this._options.targetPruningSize * POWERS[depth];
        if (this._contextual && !nonTermHasContext)
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
    private _initializeContexts(contextPhrases : Iterable<ContextPhrase>) : void {
        contextPhrases = Array.from(contextPhrases);

        const contexts = new Map<unknown, Context>();
        for (const phrase of contextPhrases) {
            const existing = contexts.get(phrase.context);
            if (existing === undefined)
                contexts.set(phrase.context, new Context(phrase.context));
        }

        for (const phrase of contextPhrases) {
            const index = phrase.symbol;
            assert(index >= 0 && index <= this._nonTermTable.size, `Invalid context number ${index}`);
            const derivation = new Derivation(phrase.key, phrase.value, phrase.utterance, contexts.get(phrase.context)!, 0, phrase.priority || 0);
            this._charts!.add(index, 0, derivation);
        }
    }

    /**
     * Reset this generator, and prepare for the next turn of generation.
     *
     * This will clear all intermediate derivations that depend on the current set of contexts.
     *
     * If hard is true, it will also clear all other derivations and reset the chart table.
     * Otheriwse, it will not clear other intermediate derivations.
     *
     * @param hard - whether to reset all derivations or only those that depend on the context
     */
    reset(hard ?: boolean) {
        if (!this._charts)
            return;
        if (hard) {
            this._charts = undefined;
            return;
        }

        for (let index = 0; index < this._nonTermList.length; index++) {
            if (this._nonTermHasContext[index]) {
                for (let depth = 0; depth <= this._options.maxDepth; depth++)
                    this._charts.reset(index, depth);
            }
        }
    }

    private _initializeCharts() {
        if (this._charts)
            return;

        this._charts = new ChartTable(this._nonTermList,
            this._options.maxDepth,
            this._options.rng);
        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            const targetPruningSize = this._options.targetPruningSize * POWERS[depth];
            for (let index = 0; index < this._nonTermList.length; index++) {
                // the chart for context symbols is never pruned, so we set size
                // to a large number (integer, to avoid floating point computations)
                if (this._contextual && depth === 0 && this.hasContext(this._nonTermList[index]))
                    this._charts.init(index, depth, INFINITY);
                else if (this._contextual && !this._nonTermHasContext[index]) // multiply non-contextual non-terminals by a factor
                    this._charts.init(index, depth, NON_CONTEXTUAL_PRUNING_SIZE_MULTIPLIER * targetPruningSize);
                else
                    this._charts.init(index, depth, targetPruningSize);
            }
        }
    }

    /**
     * Ensure that the rule is ready to generate at the given depth.
     *
     * This will ensure that all non-terminals referenced by the rule have been generated
     * at lower depths.
     *
     * @param rule
     * @param atDepth the depth at which rule will be expanded
     * @returns whether the rule should be expanded at all
     */
    private _ensureRuleReadyToGenerate(rule : Rule<unknown[], unknown>, atDepth : number, mode : GenerationMode) {
        for (const nonTerm of rule.expansion) {
            let nonTermSize = 0;
            for (let depth = 0; depth < atDepth; depth++)
                nonTermSize += this._ensureGenerated(nonTerm.index, depth, mode);

            // if some non-terminal is entirely empty across all depths, don't even bother
            // to generate the rest of the rule
            //
            // this covers the case of rules that depend on empty contexts, in particular
            // when generating for exactly one context
            if (nonTermSize === 0)
                return false;
        }

        if (rule.expansion.length === 0)
            return atDepth === 0;

        return true;
    }

    /**
     * Ensure that the given non-terminal is fully generated at the given depth.
     *
     * This will recursively generate the non-terminals that feed into the given one
     * at lower depths, then apply all the rules for this non-terminal.
     *
     * This method has no effect if the non-terminal was already generated at the given
     * depth since the last call to {@link reset}. It also has no effect if depth is
     * negative.
     *
     * @param nonTermIndex the index of the non-terminal to generate
     * @param depth the depth at which to generate
     * @param mode whether to generate and sample randomly, or whether to choose only
     *    the derivations with the highest priority
     * @returns the size of the non terminal at this depth
     */
    private _ensureGenerated(nonTermIndex : number, depth : number, mode : GenerationMode) {
        assert(nonTermIndex >= 0 && nonTermIndex <= this._nonTermList.length);
        assert(depth >= 0);

        const charts = this._charts!;
        const alreadyGenerated = charts.isChartGenerated(nonTermIndex, depth);
        const existingSize = charts.getSizeAtDepth(nonTermIndex, depth);
        if (this._options.debug >= LogLevel.EVERYTHING)
            this.log(`checking that ${this._nonTermList[nonTermIndex]} is generated at depth ${depth}: ${alreadyGenerated} (${existingSize})`);
        if (alreadyGenerated)
            return existingSize;
        if (this._options.debug >= LogLevel.VERBOSE_GENERATION)
            this.log(`generating ${this._nonTermList[nonTermIndex]} at depth ${depth}`);
        this._stackDepth ++;

        let queue : PriorityQueue<Derivation<any>>|undefined;
        if (mode === GenerationMode.BY_PRIORITY)
            queue = new PriorityQueue<Derivation<any>>();

        const targetPruningSize = Math.ceil(this._options.targetPruningSize * POWERS[depth]);
        for (const rule of this._rules[nonTermIndex]) {
            if (!rule.enabled)
                continue;
            if (this._options.debug >= LogLevel.EVERYTHING)
                this.log(`evaluating NT[${this._nonTermList[nonTermIndex]}] @ ${depth} -> ${rule}`);
            if (!this._ensureRuleReadyToGenerate(rule, depth, mode))
                continue;

            if (mode === GenerationMode.BY_PRIORITY) {
                const rulebegin = Date.now();
                try {
                    expandRule(this, charts, depth, nonTermIndex, rule, INFINITY, this._options, this._nonTermList, (derivation) => {
                        queue!.push(derivation);
                    });
                } catch(e) {
                    console.error(`Error expanding rule NT[${this._nonTermList[nonTermIndex]}] @ ${depth} -> ${rule}`);
                    throw e;
                }
                if (this._options.debug >= LogLevel.INFO) {
                    const ruleend = Date.now();
                    if (ruleend - rulebegin >= 250)
                        this.log(`NT[${this._nonTermList[nonTermIndex]}] @ ${depth} -> ${rule} took ${ruleend - rulebegin} milliseconds`);
                }
            } else {
                const ruleTarget = this._getRuleTarget(rule, nonTermIndex, depth);
                const sampler = new ReservoirSampler(ruleTarget, this._options.rng);

                try {
                    expandRule(this, charts, depth, nonTermIndex, rule, ruleTarget, this._options, this._nonTermList, (derivation) => {
                        sampler.add(derivation);
                    });
                } catch(e) {
                    console.error(`Error expanding rule NT[${this._nonTermList[nonTermIndex]}] @ ${depth} -> ${rule}`);
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

                for (const derivation of output)
                    charts.add(nonTermIndex, depth, derivation);
            }
        }

        if (mode === GenerationMode.BY_PRIORITY) {
            const initialSize = charts.getSizeAtDepth(nonTermIndex, depth);
            let nonTermSize = Math.min(queue!.size, targetPruningSize);
            for (let i = 0; i < nonTermSize; i++) {
                const derivation = queue!.pop();
                assert(derivation);
                charts.add(nonTermIndex, depth, derivation);
            }
            nonTermSize += initialSize;
            assert.strictEqual(charts.getSizeAtDepth(nonTermIndex, depth), nonTermSize);
        }

        if (this._options.debug >= LogLevel.EVERYTHING)
            this.log(`marking ${this._nonTermList[nonTermIndex]} generated at depth ${depth}`);
        charts.markGenerated(nonTermIndex, depth);
        const nonTermSize = charts.getSizeAtDepth(nonTermIndex, depth);
        if (this._options.debug >= LogLevel.GENERATION && nonTermSize > 0)
            this.log(`stats: size(charts[${depth}][${this._nonTermList[nonTermIndex]}]) = ${nonTermSize}`);

        this._stackDepth --;
        return nonTermSize;
    }

    private *_getAllDerivations(nonTermIndex : number) : IterableIterator<Derivation<any>> {
        for (let depth = 0; depth <= this._options.maxDepth; depth++)
            yield* this._charts!.getAtDepth(nonTermIndex, depth);
    }

    /**
     * Generate a batch of derivations for the given symbol, given the batch of contexts.
     *
     */
    generate(contextPhrases : Iterable<ContextPhrase>,
             symbol : string) : Iterable<Derivation<any>> {
        this.finalize();

        // enable all rules (in case we called generateOne before)
        this._enableAllRules();

        // reset progress counter for this round (only if contextual)
        this._progress = 0;

        this._initializeCharts();
        if (this._contextual)
            this._initializeContexts(contextPhrases);

        const nonTermIndex = this._lookupNonTerminal(symbol);

        this._stackDepth = 0;
        for (let depth = 0; depth <= this._options.maxDepth; depth++)
            this._ensureGenerated(nonTermIndex, depth, GenerationMode.RANDOM);

        // ensure that progress goes up to 1 at the end (to close the progress bar)
        // TODO implement actual progress calculation
        this._progress = 1;

        return this._getAllDerivations(nonTermIndex);
    }
}

function computeWorstCaseGenSize(charts : ChartTable,
                                 depth : number,
                                 rule : Rule<unknown[], unknown>,
                                 maxdepth : number) : number {
    const expansion = rule.expansion;
    if (depth === 0)
        return expansion.length === 0 ? 1 : 0;

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
            assert(Number.isFinite(tmp));
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
                          rule : Rule<unknown[], unknown>) : RuleSizeEstimate {
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

    const estimatedPruneFactor = rule.estimatedPruningFactor;
    const estimatedGenSize = worstCaseGenSize * estimatedPruneFactor;
    return { maxdepth, worstCaseGenSize, reducedWorstCaseGenSize, estimatedGenSize, estimatedPruneFactor } ;
}

interface ExpandOptions {
    debug : number;
    rng : () => number;
}

function getKeyConstraint(choices : Array<Derivation<any>>,
                          nonTerm : NonTerminal) : [string, DerivationKeyValue]|null {
    if (nonTerm.relativeKeyConstraint) {
        const [ourIndexName, otherNonTerminal, otherIndexName] = nonTerm.relativeKeyConstraint;
        const otherChoice = choices[otherNonTerminal];
        const keyValue = otherChoice.key[otherIndexName];
        assert(keyValue !== undefined);
        return [ourIndexName, keyValue];
    } else if (nonTerm.constantKeyConstraint) {
        return nonTerm.constantKeyConstraint;
    } else {
        return null;
    }
}

function* iterchain<T>(iter1 : Iterable<T>, iter2 : Iterable<T>) : Iterable<T> {
    yield* iter1;
    yield* iter2;
}

function expandRuleExhaustive(generator : SentenceGenerator,
                              charts : ChartTable,
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
    // terminals are treated as having only 0 productions
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

    if (maxdepth < depth-1 && options.debug >= LogLevel.INFO)
        generator.log(`expand NT[${nonTermList[nonTermIndex]}] @ ${depth} -> ${rule} : reduced max depth to avoid exponential behavior`);

    if (options.debug >= LogLevel.EVERYTHING)
        generator.log(`expand NT[${nonTermList[nonTermIndex]}] @ ${depth} -> ${rule} : worst case ${sizeEstimate.worstCaseGenSize}, expect ${Math.round(sizeEstimate.estimatedGenSize)}`);

    const estimatedPruneFactor = sizeEstimate.estimatedPruneFactor;
    const choices : Array<Derivation<any>> = [];
    // fill and size the array
    for (let i = 0; i < expansion.length; i++)
        choices.push(undefined!);
    let actualGenSize = 0;
    let prunedGenSize = 0;
    let coinProbability = basicCoinProbability;
    for (let pivotIdx = 0; pivotIdx < expansion.length; pivotIdx++) {
        const fixeddepth = depth-1;
        (function recursiveHelper(k : number, context : Context|null) {
            if (k === expansion.length) {
                //generator.log('combine: ' + choices.join(' ++ '));
                //generator.log('depths: ' + depths);
                if (!(coinProbability < 1.0) || coin(coinProbability, rng)) {
                    const v = rule.apply(choices, depth);
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
                    } else if (context !== null) {
                        // if we have chosen a context, either pick something with
                        // no context or something with the same context
                        candidates = iterchain(charts.getAtDepthForKey(currentExpansion.index,
                            fixeddepth,
                            CONTEXT_KEY_NAME, null),
                        charts.getAtDepthForKey(currentExpansion.index,
                            fixeddepth,
                            CONTEXT_KEY_NAME, context));
                    } else {
                        candidates = charts.getAtDepth(currentExpansion.index, fixeddepth);
                    }
                } else {
                    const upToDepth = k > pivotIdx ? maxdepth : maxdepth-1;

                    if (constraint) {
                        const [indexName, keyValue] = constraint;
                        candidates = charts.getUpToDepthForKey(currentExpansion.index,
                            upToDepth,
                            indexName, keyValue);
                    } else if (context !== null) {
                        // if we have chosen a context, either pick something with
                        // no context or something with the same context
                        candidates = iterchain(charts.getUpToDepthForKey(currentExpansion.index,
                            upToDepth,
                            CONTEXT_KEY_NAME, null),
                        charts.getUpToDepthForKey(currentExpansion.index,
                            upToDepth,
                            CONTEXT_KEY_NAME, context));
                    } else {
                        candidates = charts.getUpToDepth(currentExpansion.index, upToDepth);
                    }
                }

                for (const candidate of candidates) {
                    if (!Context.compatible(context, candidate.context))
                        continue;
                    const newContext = Context.meet(context, candidate.context);
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

function expandRuleSample(generator : SentenceGenerator,
                          charts : ChartTable,
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
        const choices : Array<Derivation<any>> = [];
        // fill and size the array
        for (let i = 0; i < expansionLenght; i++)
            choices.push(undefined!);

        outerloop:
        for (let sampleIdx = 0; sampleIdx < targetSemanticFunctionCalls && actualGenSize < targetPruningSize; sampleIdx++) {
            let newContext : Context|null = null;
            for (let i = 0; i < expansionLenght; i++) {
                const currentExpansion = expansion[i];

                // apply the key constraint if we have it
                const constraint = getKeyConstraint(choices, currentExpansion);
                let choice;
                if (constraint) {
                    const [indexName, keyValue] = constraint;
                    choice = charts.chooseAtDepthForKey(currentExpansion.index, 0, indexName, keyValue);
                } else if (newContext !== null) {
                    // try with no context first, then try with the same context
                    // this is not exactly correct sampling wise, but we don't
                    // have a lot of mixed non-terminals (in fact, I can't think
                    // of any) so it's mostly good enough
                    choice = charts.chooseAtDepthForKey(currentExpansion.index, 0, CONTEXT_KEY_NAME, null);
                    if (!choice)
                        choice = charts.chooseAtDepthForKey(currentExpansion.index, 0, CONTEXT_KEY_NAME, newContext);
                } else {
                    choice = charts.chooseAtDepth(currentExpansion.index, 0);
                }
                if (!choice) // no compatible derivation with these keys
                    continue outerloop;
                choices[i] = choice;
                if (!Context.compatible(newContext, choice.context))
                    continue outerloop;
                newContext = Context.meet(newContext, choice.context);
            }

            const v = rule.apply(choices, depth);
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
    const choices : Array<Derivation<any>> = [];
    // fill and size the array
    for (let i = 0; i < expansionLenght; i++)
        choices.push(undefined!);

    outerloop:
    for (let sampleIdx = 0; sampleIdx < targetSemanticFunctionCalls && actualGenSize < targetPruningSize; sampleIdx++) {
        let newContext : Context|null = null;

        // choose the pivot
        const pivotIdx = categoricalPrecomputed(pivotProbabilityCumsum, pivotProbabilityCumsum.length, rng);

        for (let i = 0; i < expansionLenght; i++) {
            const currentExpansion = expansion[i];
            if (i === pivotIdx) {
                // apply the key constraint if we have it
                const constraint = getKeyConstraint(choices, currentExpansion);
                let choice;
                if (constraint) {
                    const [indexName, keyValue] = constraint;
                    choice = charts.chooseAtDepthForKey(currentExpansion.index, depth-1,
                        indexName, keyValue);
                } else if (newContext !== null) {
                    // try with no context first, then try with the same context
                    // (see above for longer explanation)
                    choice = charts.chooseAtDepthForKey(currentExpansion.index, depth-1, CONTEXT_KEY_NAME, null);
                    if (!choice)
                        choice = charts.chooseAtDepthForKey(currentExpansion.index, depth-1, CONTEXT_KEY_NAME, newContext);
                } else {
                    choice = charts.chooseAtDepth(currentExpansion.index, depth-1);
                }

                if (!choice) // no compatible derivation with these keys
                    continue outerloop;
                choices[i] = choice;
            } else {
                const maxdepth = i < pivotIdx ? depth-2 : depth-1;

                const constraint = getKeyConstraint(choices, currentExpansion);
                let choice;
                if (constraint) {
                    const [indexName, keyValue] = constraint;
                    choice = charts.chooseUpToDepthForKey(currentExpansion.index, maxdepth,
                        indexName, keyValue);
                } else if (newContext !== null) {
                    // try with no context first, then try with the same context
                // (see above for longer explanation)
                    choice = charts.chooseUpToDepthForKey(currentExpansion.index, maxdepth, CONTEXT_KEY_NAME, null);
                    if (!choice)
                        choice = charts.chooseUpToDepthForKey(currentExpansion.index, maxdepth, CONTEXT_KEY_NAME, newContext);
                } else {
                    choice = charts.chooseUpToDepth(currentExpansion.index, maxdepth);
                }
                if (!choice) // no compatible derivation with these keys
                    continue outerloop;
                choices[i] = choice;
            }

            const chosen = choices[i];
            if (chosen instanceof Derivation) {
                if (!Context.compatible(newContext, chosen.context))
                    continue outerloop;
                newContext = Context.meet(newContext, chosen.context);
            }
        }

        const v = rule.apply(choices, depth);
        if (v !== null) {
            actualGenSize ++;
            emit(v);
        } else {
            prunedGenSize ++;
        }
    }

    return [actualGenSize, prunedGenSize];
}

function expandRule(generator : SentenceGenerator,
                    charts : ChartTable,
                    depth : number,
                    nonTermIndex : number,
                    rule : Rule<any[], any>,
                    targetPruningSize : number,
                    options : ExpandOptions,
                    nonTermList : string[],
                    emit : (value : Derivation<any>) => void) : void {
    const expansion = rule.expansion;

    if (depth === 0) {
        if (expansion.length === 0) {
            const deriv = rule.apply([], depth);
            if (deriv !== null)
                emit(deriv);
        }
        return;
    }

    const sizeEstimate =
        estimateRuleSize(charts, depth, nonTermIndex, rule);
    const { maxdepth, worstCaseGenSize, estimatedGenSize, estimatedPruneFactor } = sizeEstimate;

    if (options.debug >= LogLevel.EVERYTHING)
        generator.log(`expand NT[${nonTermList[nonTermIndex]}] @ ${depth} -> ${expansion.join(' ')} : worst case estimate ${worstCaseGenSize}`);
    if (worstCaseGenSize === 0)
        return;

    const now = Date.now();

    // to avoid spending too much time calling the combiner for things we'll prune later,
    // we randomly sample out of all possible combinations about as many as we estimate
    // we'll need to fill the reservoir
    const coinProbability = Math.min(1, targetPruningSize / estimatedGenSize);

    // make an estimate of the number of times we'll need to call the semantic function
    // to get the target pruning size
    const targetSemanticFunctionCalls = Math.min(targetPruningSize / estimatedPruneFactor, SAMPLING_PRUNE_SIZE);

    //generator.log('expand $' + nonterminal + ' -> ' + expansion.join('') + ' : actual ' + actualGenSize);

    let actualGenSize, prunedGenSize;
    let strategy;
    if (sizeEstimate.maxdepth === depth-1 && (coinProbability >= 1 || targetSemanticFunctionCalls >= worstCaseGenSize * 0.8)) {
        if (options.debug >= LogLevel.EVERYTHING)
            generator.log(`expand NT[${nonTermList[nonTermIndex]}] @ ${depth} -> ${rule} : using recursive expansion`);

        // use the exhaustive algorithm if we expect to we'll be close to exhaustive anyway
        [actualGenSize, prunedGenSize] = expandRuleExhaustive(generator, charts, depth, maxdepth, coinProbability,
            nonTermIndex, rule, sizeEstimate, targetPruningSize,
            options, nonTermList, emit);
        strategy = 'enumeration';
    } else {
        if (options.debug >= LogLevel.EVERYTHING)
            generator.log(`expand NT[${nonTermList[nonTermIndex]}] @ ${depth} -> ${rule} : using sampling`);

        // otherwise use the imprecise but faster sampling algorithm
        [actualGenSize, prunedGenSize] = expandRuleSample(generator, charts, depth,
            nonTermIndex, rule, sizeEstimate, targetSemanticFunctionCalls, targetPruningSize,
            options, nonTermList, emit);
        strategy = 'sampling';
    }

    if (actualGenSize + prunedGenSize === 0)
        return;
    const newEstimatedPruneFactor = actualGenSize / (actualGenSize + prunedGenSize);
    if (options.debug >= LogLevel.VERBOSE_GENERATION && newEstimatedPruneFactor < 0.2)
        generator.log(`expand NT[${nonTermList[nonTermIndex]}] @ ${depth} -> ${rule} : semantic function only accepted ${(newEstimatedPruneFactor*100).toFixed(1)}% of derivations`);

    const elapsed = Date.now() - now;
    if (options.debug >= LogLevel.INFO && elapsed >= 10000)
        generator.log(`expand NT[${nonTermList[nonTermIndex]}] @ ${depth} -> ${rule} : took ${(elapsed/1000).toFixed(2)} seconds using ${strategy}`);

    const movingAverageOfPruneFactor = (0.01 * estimatedPruneFactor + newEstimatedPruneFactor) / (1.01);
    rule.estimatedPruningFactor = movingAverageOfPruneFactor;
}
