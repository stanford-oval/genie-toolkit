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
//          Mehrad Moradshahi <mehrad@cs.stanford.edu>


import assert from 'assert';

import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import { Ast, Type, Syntax } from 'thingtalk';
import * as Units from 'thingtalk-units';

import { coin, randint, uniform } from '../../utils/random';
import binarySearch from '../../utils/binary_search';
import * as I18n from '../../i18n';
import { sampleString } from '../../utils/misc-utils';
import { makeDummyEntity, EntityMap } from '../../utils/entity-utils';
import * as ThingTalkUtils from '../../utils/thingtalk';
import { SentenceExample, SentenceFlags } from '../parsers';

function isReplaceToken(tok : string) : boolean {
    return /^(?:GENERIC_ENTITY|LOCATION|NUMBER|QUOTED_STRING|HASHTAG|USERNAME)_/.test(tok) &&
        !tok.startsWith('GENERIC_ENTITY_tt:device_id_');
}

function tokenCanAppearInSentence(token : string) {
    return /^(?:QUOTED_STRING|HASHTAG|USERNAME)_/.test(token);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isUnitName(token : string) {
    if (token.startsWith('unit:'))
        return true;

    // normally, a unit name is just an identifier (ie, it matches the identifier
    // grammar and is not a keyword)
    // but!
    // - "in" (inches) is a reserved word (for..in)
    // - "min" (minutes) is a contextual keyword (aggregate)
    // - "and" / "or" are keywords in legacy NN syntax

    return (IDENTIFIER.test(token) && !Syntax.KEYWORDS.has(token) && !Syntax.CONTEXTUAL_KEYWORDS.has(token) &&
        token !== 'and' && token !== 'or') || token === 'in' || token === 'min';
}

const NON_REPLACEABLE_ENTITIES = ['tt:url', 'tt:email_address',
    'tt:function', 'tt:picture', 'tt:flow_token', 'tt:path_name'];

function isReplaceType(type : Type) {
    return type.isLocation || type.isString || type.isNumber || type.isMeasure ||
        (type instanceof Type.Entity && NON_REPLACEABLE_ENTITIES.indexOf(type.type) < 0);
}

function isEntity(value : ConstantValue) {
    if (value instanceof Ast.VarRefValue && value.name.startsWith(`__const_`)) {
        // this is the correct type refinement, but for some reason without
        // the explicit assignment value is typed "Ast.VarRefValue" instead
        const cvalue : Ast.VarRefValue & ConstantValue = value;
        if (!cvalue.token)
            cvalue.token = constantToNN(cvalue.name);
        return true;
    } else {
        return false;
    }
}

function unescape(symbol : string) : string {
    return symbol.replace(/_([0-9a-fA-Z]{2}|_)/g, (match, ch) => {
        if (ch === '_') return ch;
        return String.fromCharCode(parseInt(ch, 16));
    });
}

function constantToNN(constant : string) : string {
    const measure = /__const_NUMBER_([0-9]+)__([a-z0-9A-Z]+)/.exec(constant);
    if (measure !== null)
        return 'NUMBER_' + measure[1];
    const underscoreindex = constant.lastIndexOf('_');
    const entitytype = unescape(constant.substring('__const_'.length, underscoreindex));
    return entitytype + constant.substring(underscoreindex);
}

type ParameterRecord = Tp.FileParameterProvider.ParameterRecord;
type Sampler = Tp.FileParameterProvider.Sampler;

class NumberSampler implements Sampler {
    private _min : number;
    private _max : number;
    private _isMeasure : boolean;

    constructor(min : number, max : number, isMeasure : boolean) {
        this._min = min;
        this._max = max;
        this._isMeasure = isMeasure;
        assert(Number.isFinite(min));
        assert(Number.isFinite(max));
    }

    get size() : number {
        return this._min < this._max ? Infinity : 0; // we can sample as much as we want
    }

    private _checkFinite(value : number) {
        if (Number.isFinite(value))
            return;

        throw new Error(`Unexpected ${value} with bounds ${this._min} / ${this._max} (isMeasure = ${this._isMeasure})`);
    }

    async sample(rng : () => number) : Promise<ParameterRecord> {
        if (this._isMeasure) {
            // for measurements, sample uniformly between the (adjusted) bounds,

            const value = (this._min + (this._max - this._min) * rng());
            this._checkFinite(value);
            if (Math.abs(value) > 2)
                return { preprocessed: value.toFixed(coin(0.9, rng) ? 0 : 1), value: '', weight: 1.0 };
            else
                return { preprocessed: value.toPrecision(2), value: '', weight: 1.0 };
        }

        // sample an "easy" number
        // that is, a number with one or two significant digits and enough
        // trailing zeros to fit in the range
        let val;

        do {
            // first choose the sign of the number
            let sign = 1, min, max;
            if (this._min < 0 && this._max > 0) {
                sign = coin(0.8, rng) ? 1 : -1;
                min = 0;
                max = sign < 0 ? -this._min : this._max;
            } else if (this._min < 0 && this._max <= 0) {
                sign = -1;
                min = -this._max;
                max = -this._min;
            } else {
                min = this._min;
                max = this._max;
            }
            assert(min >= 0);
            assert(max >= 0);

            // choose the value of the number
            val = randint(1, 99, rng);

            // add or subtract enough zeros to fit in the range
            const minlog = Math.floor(Math.log10(1+min)) - 1 - (val >= 10 ? 1 : 0);
            const maxlog = Math.floor(Math.log10(1+max)) - (val >= 10 ? 1 : 0);
            val *= 10**randint(minlog, maxlog, rng);
            val = sign * Math.round(val);

            // note: 0 and 1 are very special (not normalized by the tokenizer)
            // so we don't generate them here, ever
        } while (val < this._min || val > this._max || val === 0 || val === 1);

        this._checkFinite(val);
        return { preprocessed: String(val), value: '', weight: 1.0 };
    }
}

class WeightedSampler implements Sampler {
    private _values : ParameterRecord[];
    private _cumsum : number[];

    constructor(values : ParameterRecord[]) {
        this._values = values;

        if (values.length > 0) {
            const cumsum = new Array(values.length);
            cumsum[0] = values[0].weight ?? 1;
            for (let i = 1; i < values.length; i++)
                cumsum[i] = cumsum[i-1] + (values[i].weight ?? 1);
            this._cumsum = cumsum;
        } else {
            this._cumsum = [];
        }
    }

    get size() : number {
        return this._values.length;
    }

    async sample(rng : () => number) : Promise<ParameterRecord> {
        const sample = rng() * this._cumsum[this._cumsum.length-1];
        return this._values[binarySearch(this._cumsum, sample)];
    }
}

class UniformSampler implements Sampler {
    private _values : ParameterRecord[];

    constructor(values : ParameterRecord[]) {
        this._values = values;
    }

    get size() : number {
        return this._values.length;
    }

    async sample(rng : () => number) {
        return uniform(this._values, rng);
    }
}

class SequentialSampler implements Sampler {
    private _values : ParameterRecord[];
    private _index : number;
    constructor(values : ParameterRecord[]) {
        this._values = values;
        this._index = 0;
    }

    get size() {
        return this._values.length;
    }

    async sample(rng : () => number) {
        if (this._index === this._values.length)
            this._index = 0;
        const value = this._values[this._index];
        this._index += 1;
        return value;
    }
}

export interface ParameterProvider {
    getSampler(type : 'entity'|'string', key : string, mode : Tp.FileParameterProvider.SampleMode) : Promise<Sampler>;
    get(type : 'entity'|'string', key : string) : Promise<ParameterRecord[]>;
}

type SamplingType = 'random' | 'uniform' | 'default' | 'sequential';

class ValueListLoader {
    private _provider : ParameterProvider;
    private _cache : Map<string, Promise<Sampler>>;
    private _samplingType : SamplingType;
    private _subsetParamSet : [number, number];
    private _rng : () => number;

    constructor(provider : ParameterProvider,
                samplingType : SamplingType = 'default',
                subsetParamSet : [number, number] = [0, 1],
                rng : () => number) {
        this._provider = provider;

        this._cache = new Map;
        this._samplingType = samplingType;
        this._subsetParamSet = subsetParamSet;
        this._rng = rng;
    }

    get([valueListType, valueListName] : ['string'|'entity', string|string[]]) : Promise<Sampler> {
        const name = Array.isArray(valueListName) ? valueListName[0] : valueListName;
        const key = valueListType + ':' + name;
        if (this._cache.has(key))
            return this._cache.get(key)!;

        const promise = this._load(valueListType, valueListName);
        this._cache.set(key, promise);
        return promise;
    }

    private async _load(valueListType : 'string'|'entity', valueListName : string|string[]) : Promise<Sampler> {
        if (!Array.isArray(valueListName))
            valueListName = [valueListName];

        // try handling the common cases without loading the entire list of rows
        // in memory
        // the sampler returned in this case use sqlite to sample
        if (valueListName.length === 1 &&
            this._samplingType !== 'random' &&
            this._subsetParamSet[0] === 0 &&
            this._subsetParamSet[1] === 1) {
            let sampleMode;
            if (this._samplingType === 'sequential')
                sampleMode = Tp.FileParameterProvider.SampleMode.SEQUENTIAL;
            else if (this._samplingType === 'uniform')
                sampleMode = Tp.FileParameterProvider.SampleMode.UNIFORM;
            else
                sampleMode = Tp.FileParameterProvider.SampleMode.WEIGHTED;
            return this._provider.getSampler(valueListType, valueListName[0], sampleMode);
        }

        let rows : ParameterRecord[] = [];
        for (const name of valueListName)
            rows = rows.concat(await this._provider.get(valueListType, name));

        // overwrite weights with random values
        if (this._samplingType === 'random') {
            for (const row of rows)
                row.weight = Math.round(this._rng() * 100);
        } else if (this._samplingType === 'uniform') {
            for (const row of rows)
                row.weight = 1;
        }

        const [beg, end] = this._subsetParamSet;
        const rows_size = rows.length;
        const slice_beg = beg * rows_size;
        let slice_end;
        // make sure we have at least one row
        if ((end - beg) * rows_size < 1.0)
            slice_end = slice_beg + 1;
        else
            slice_end = end * rows_size;
        rows = rows.slice(slice_beg, slice_end);

        let minWeight = Infinity, maxWeight = -Infinity;
        let sumWeight = 0;
        for (const row of rows) {
            minWeight = Math.min(row.weight||1, minWeight);
            maxWeight = Math.max(row.weight||1, maxWeight);
            sumWeight += row.weight||1;
        }

        // if all weights are approximately equal
        // (ie, the range is significantly smaller than the average)
        // we use a uniform sampler, which is faster
        if (this._samplingType === 'sequential')
            return new SequentialSampler(rows);
        else if ((maxWeight - minWeight) / (sumWeight / rows.length) < 0.0001)
            return new UniformSampler(rows);
        else
            return new WeightedSampler(rows);
    }
}

function* resampleIgnorableAndAbbreviations(langPack : I18n.LanguagePack,
                                            ptype : Type,
                                            sentence : string[],
                                            rng : () => number) : IterableIterator<string> {
    if (!(ptype instanceof Type.Entity)) {
        yield *sentence;
        return;
    }
    const ignorable = ptype.type.startsWith('sportradar') ? langPack.IGNORABLE_TOKENS['sportradar'] : (langPack.IGNORABLE_TOKENS[ptype.type] || []);

    for (const word of sentence) {
        if (ignorable.indexOf(word) >= 0) {
            if (coin(0.5, rng))
                yield word;
        } else if (word in langPack.ABBREVIATIONS) {
            yield uniform(langPack.ABBREVIATIONS[word], rng);
        } else {
            yield word;
        }
    }
}

function _default<T>(v : T|undefined, def : T) : T {
    if (v === undefined)
        return def;
    else
        return v;
}

interface ParameterReplacerOptions {
    thingpediaClient : Tp.BaseClient;
    schemaRetriever : ThingTalk.SchemaRetriever;
    constProvider : ParameterProvider;

    paramLocale : string;
    timezone : string;
    rng : () => number;
    debug ?: boolean;

    addFlag ?: boolean;
    quotedProbability ?: number;
    untypedStringProbability ?: number;
    maxSpanLength ?: number;
    cleanParameters ?: boolean;
    requotable ?: boolean;
    includeEntityValue ?: boolean;
    numAttempts ?: number;
    syntheticExpandFactor ?: number;
    noQuoteExpandFactor ?: number;
    paraphrasingExpandFactor ?: number;
    samplingType ?: SamplingType;
    subsetParamSet ?: [number, number];
}

interface ReplacementRecord {
    sentenceValue : string;
    programValue : ParameterRecord;
}

// a bit of a HACK because we add the "token" property to Ast.Value
type ConstantValue = Ast.Value & { token ?: string };

export default class ParameterReplacer {
    private _tpClient : Tp.BaseClient;
    private _schemas : ThingTalk.SchemaRetriever;
    private _loader : ValueListLoader;
    private _rng : () => number;

    private _addFlag : boolean;
    private _paramLangPack : I18n.LanguagePack;
    private _timezone : string;
    private _quotedProbability : number;
    private _untypedStringProbability : number;
    private _maxSpanLength : number;
    private _cleanParameters : boolean;
    private _requotable : boolean;
    private _includeEntityValue : boolean;
    private _numAttempts : number;
    private _debug : boolean;
    private _blowUpSynthetic : number;
    private _blowUpNoQuote : number;
    private _blowUpParaphrasing : number;
    private _blowUpAugmented : number;
    private _entityDescendants ?: Record<string, string[]>;

    private _warned : Set<string>;

    constructor(options : ParameterReplacerOptions) {
        this._tpClient = options.thingpediaClient;
        this._schemas = options.schemaRetriever;
        this._loader = new ValueListLoader(options.constProvider, options.samplingType, options.subsetParamSet, options.rng);
        this._rng = options.rng;
        this._timezone = options.timezone;
        this._addFlag = _default(options.addFlag, false);
        this._paramLangPack = I18n.get(options.paramLocale);
        this._quotedProbability = _default(options.quotedProbability, 0.1);
        this._untypedStringProbability = _default(options.untypedStringProbability, 0.01);
        this._maxSpanLength = _default(options.maxSpanLength, 10);
        this._cleanParameters = _default(options.cleanParameters, true);
        this._requotable = _default(options.requotable, true);
        this._includeEntityValue = _default(options.includeEntityValue, false);
        this._numAttempts = _default(options.numAttempts, 10000);
        this._debug = _default(options.debug, true);

        this._blowUpSynthetic = _default(options.syntheticExpandFactor, 5);
        this._blowUpNoQuote = _default(options.noQuoteExpandFactor, 10);
        this._blowUpParaphrasing = _default(options.paraphrasingExpandFactor, 30);
        this._blowUpAugmented = Math.ceil(this._blowUpParaphrasing/2);

        this._warned = new Set;
    }

    private _warn(key : string, message : string) {
        if (!this._warned.has(key)) {
            console.error(message);
            this._warned.add(key);
        }
    }

    private _blowupFactor(example : SentenceExample, params : Map<string, Ast.AbstractSlot>) {
        if (example.flags.synthetic)
            return this._blowUpSynthetic;
        if (params.size === 0)
            return this._blowUpNoQuote;
        if (example.flags.augmented)
            return this._blowUpAugmented;
        return this._blowUpParaphrasing;
    }

    private _getSlotArg(slot : Ast.AbstractSlot) : Ast.ArgumentDef|null {
        if (slot.tag === 'attribute.name')
            return null;

        let pname;
        if (slot.tag.startsWith('in_param.') || slot.tag.startsWith('result.'))
            pname = slot.tag.split('.')[1];
        else if (slot.tag.startsWith('filter.'))
            pname = slot.tag.split('.')[2];
        else if (!(slot.tag.startsWith('computations.') ||
            slot.tag.startsWith('sort.') ||
            slot.tag.startsWith('compute_filter.') ||
            slot.tag === 'slice.limit')) // other slots should have the right number
            throw new Error(`Unrecognized slot tag ${slot.tag}`);

        let arg = slot.arg;
        const prim = slot.primitive;
        if (!arg && prim && prim.schema && pname)
            arg = prim.schema.getArgument(pname)!;
        if (!arg) {
            this._warn('noarg:' + slot.tag + ':' + slot.type, `Found no argument property for ${slot.tag}:${slot.type}`);
            return null;
        }
        return arg;
    }

    private async _getParamListKey(slot : Ast.AbstractSlot, arg : Ast.ArgumentDef|null) : Promise<['string'|'entity', string|string[]]> {
        const prim = slot.primitive;
        if (prim === null && (
            slot.tag === 'filter.==.$source' ||
            slot.tag.startsWith('filter.in_array.$source') ||
            slot.tag === 'program.principal'))
            return ['string', 'tt:person_first_name'];

        if (!slot.type.isEntity && !slot.type.isString && !slot.type.isLocation && !slot.type.isMeasure)
            throw new TypeError(`Unexpected replaced type ${slot.type}`);

        if (slot.tag === 'attribute.name') {
            assert(prim instanceof Ast.Invocation || prim instanceof Ast.ExternalBooleanExpression);
            const selector = prim.selector;
            assert(selector instanceof Ast.DeviceSelector);
            return ['string', selector.kind + ':__name'];
        }

        if (arg) {
            const stringValues = arg.getImplementationAnnotation<string>('string_values');
            if (stringValues)
                return ['string', stringValues];
        }

        if (slot.type instanceof Type.Entity)
            return this._getEntityListKey(slot.type.type);

        return ['string', this._getFallbackParamListKey(slot)];
    }

    private async _loadEntityDescendants() {
        this._entityDescendants = {};
        const entities = await this._tpClient.getAllEntityTypes();
        for (const entity of entities) {
            if (!entity.subtype_of)
                continue;
            for (const parent of entity.subtype_of) {
                if (!(parent in this._entityDescendants))
                    this._entityDescendants[parent] = [parent];
                this._entityDescendants[parent].push(entity.type);
            }
        }
    }

    private async _getDescendants(entityType : string) : Promise<string[]> {
        if (!this._entityDescendants)
            await this._loadEntityDescendants();
        return this._entityDescendants![entityType] ?? [entityType];
    }

    private async _getEntityListKey(entityType : string) : Promise<['string'|'entity', string|string[]]> {
        switch (entityType) {
        case 'tt:username':
        case 'tt:contact':
        case 'tt:email_address':
            return ['string', 'tt:person_first_name'];
        case 'tt:phone_number':
            return ['string', 'tt:phone_number'];
        case 'tt:hashtag':
            return ['string', 'tt:word'];
        case 'tt:path_name':
            return ['string', 'tt:path_name'];
        default:
            return ['entity', await this._getDescendants(entityType)];
        }
    }

    private _getFallbackParamListKey(slot : Ast.AbstractSlot) {
        if (slot.type.isLocation)
            return 'tt:location';
        if (slot.type.isNumber)
            return 'tt:number';
        if (slot.type.isMeasure)
            return 'tt:number';

        switch (slot.tag) {
        case 'in_param.message':
        case 'in_param.snippet':
        case 'in_param.text':
        case 'in_param.description':
        case 'in_param.status':
        case 'in_param.body':
        case 'filter.=~.message':
        case 'filter.=~.snippet':
        case 'filter.=~.text':
        case 'filter.=~.description':
        case 'filter.=~.status':
        case 'filter.=~.body':
            return 'tt:long_free_text';

        default:
            return 'tt:short_free_text';
        }
    }

    private _transformValue(sentenceValue : string, programValue : ParameterRecord, arg : Ast.ArgumentDef|null) : ReplacementRecord {
        if (this._requotable)
            return { sentenceValue, programValue };

        if (arg && arg.metadata.pluralize && coin(0.5, this._rng)) {
            const plural = this._paramLangPack.pluralize(sentenceValue);
            if (plural)
                return { sentenceValue: plural, programValue };
        }

        let hasDefiniteArticle = false;
        if (this._paramLangPack.DEFINITE_ARTICLE_REGEXP) {
            // remove a definite article ("the") from the program value if we have it
            const match = this._paramLangPack.DEFINITE_ARTICLE_REGEXP.exec(programValue.preprocessed);
            if (match !== null) {
                hasDefiniteArticle = true;
                programValue.preprocessed = programValue.preprocessed.substring(match[0].length);
                if (coin(0.5, this._rng))
                    sentenceValue = sentenceValue.substring(match[0].length);
            }
        }

        // hack for hotel & linkedin/books domain: remove "hotel" in the end of names; remove "award" at the end of awards
        if (arg && arg.name === 'id' && arg.type instanceof Type.Entity && arg.type.type.endsWith(':Hotel') && programValue.preprocessed.endsWith(' hotel')) {
            programValue.preprocessed = programValue.preprocessed.substring(0, programValue.preprocessed.length - ' hotel'.length);
            if (coin(0.5, this._rng))
                sentenceValue = sentenceValue.substring(0, sentenceValue.length - ' hotel'.length);
        }

        const suffixToRemove : { [key : string] : string[] }  = { award: [' award', ' awards'] };
        for (const argname in suffixToRemove) {
            for (const suffix of suffixToRemove[argname]) {
                if (arg && arg.name === argname && programValue.preprocessed.endsWith(suffix)) {
                    programValue.preprocessed = programValue.preprocessed.substring(0, programValue.preprocessed.length - suffix.length);
                    if (coin(0.5, this._rng))
                        sentenceValue = sentenceValue.substring(0, sentenceValue.length - suffix.length);
                }
            }
        }

        if (!hasDefiniteArticle && arg && arg.name === 'id' && coin(0.5, this._rng)) {
            // else add it to the sentence value if the argument is an entity
            const added = this._paramLangPack.addDefiniteArticle(sentenceValue);
            if (added)
                sentenceValue = added;
        }

        return { sentenceValue, programValue };
    }

    private async _getValueListForSlot(slot : Ast.AbstractSlot) : Promise<[Sampler, Ast.ArgumentDef|null, Type, string]> {
        const arg = this._getSlotArg(slot);

        let operator;
        if (slot.tag.startsWith('filter.'))
            operator = slot.tag.split('.')[1];
        else
            operator = '==';
        if (operator === '=~') {
            const arg = slot.arg;
            if (arg && arg.type.isEntity)
                operator = '==';
        }

        if (slot.type === Type.Number || slot.type instanceof Type.Measure) {
            let unit = '';
            if (slot.type instanceof Type.Measure) {
                const value = slot.get();
                assert(value instanceof Ast.VarRefValue);
                const match = /__const_NUMBER_[0-9]+__([a-zA-Z0-9]+)/.exec(value.name)!;
                unit = match[1];
            }

            let min = 0, max = 1000;
            if (arg) {
                min = arg.getImplementationAnnotation<number>('min_number') ?? 0;
                max = arg.getImplementationAnnotation<number>('max_number') ?? 1000;

                if (unit) {
                    if (unit === 'defaultTemperature')
                        unit = this._paramLangPack.getDefaultTemperatureUnit();

                    min = Units.transformFromBaseUnit(min, unit);
                    max = Units.transformFromBaseUnit(max, unit);
                }
            } else if (slot.tag === 'slice.limit') {
                min = 1;
                max = 5;
            }
            return [new NumberSampler(min, max, !!unit), arg, slot.type, operator];
        }

        let valueListKey = await this._getParamListKey(slot, arg);
        const fallbackKey = this._getFallbackParamListKey(slot);
        if (valueListKey[0] === 'string') {
            if (valueListKey[1] === fallbackKey) {
                const isExplicit = arg ? !!arg.getImplementationAnnotation<string>('string_values') : false;
                if (!isExplicit) {
                    this._warn('default-free-text:' + slot.tag + ':' + slot.type,
                        `Using default value of ${valueListKey[0]} ${valueListKey[1]} for ${slot.tag}:${slot.type}`);
                }
            } else {
                if (coin(this._untypedStringProbability, this._rng))
                    valueListKey = ['string', fallbackKey];
            }
        }

        let valueList = await this._loader.get(valueListKey);
        if (valueList.size === 0) {
            if (this._debug) {
                this._warn('novalue:' + slot.tag + ':' + slot.type + ':' + valueListKey[0] + ':' + valueListKey[1],
                    `Found no values for ${slot.tag}:${slot.type} (searching for ${valueListKey[0]} ${valueListKey[1]}), falling back to ${fallbackKey}`);
            }

            valueList = await this._loader.get(['string', fallbackKey]);
            if (valueList.size === 0)
                throw new Error(`Fallback value list is empty: missing required parameter list ${fallbackKey} for ${slot.tag}:${slot.type}`);
        }

        return [valueList, arg, slot.type, operator];
    }

    private async _getValueListForToken(token : string) : Promise<[Sampler, Type, string]> {
        let type, valueListKey : ['string' | 'entity', string], fallbackKey;
        if (token.startsWith('NUMBER_')) {
            // choose reasonable bounds if we don't know the bound
            const match = /NUMBER_[0-9]+__([a-zA-Z0-9]+)/.exec(token);
            return [new NumberSampler(0, 1000, !!match),
                match ? new Type.Measure(match[1]) : Type.Number, '='];
        } else if (token.startsWith('LOCATION_')) {
            valueListKey = ['string', 'tt:location'];
            fallbackKey = 'tt:location';
            type = Type.Location;
        } else if (token.startsWith('GENERIC_ENTITY_')) {
            const match = /^GENERIC_ENTITY_(.*)_[0-9]+$/.exec(token)!;
            type = new Type.Entity(match[1]);
            const [kind, name] = match[1].split(':');
            // try looking up the function in Thingpedia and looking at the
            // #[string_values] of the `id` parameter
            valueListKey = ['entity', match[1]];
            if (kind !== 'tt') {
                try {
                    const fnDef = await this._schemas.getMeta(kind, 'query', name);
                    const id = fnDef.getArgument('id');
                    if (id && id.type.equals(type)) {
                        const stringValues = id.getImplementationAnnotation<string>('string_values');
                        if (stringValues)
                            valueListKey = ['string', stringValues];
                    }
                } catch(e) {
                    // ignore
                }
            }
            fallbackKey = 'tt:short_free_text';
        } else {
            valueListKey = ['string', 'tt:short_free_text'];
            fallbackKey = 'tt:short_free_text';
            type = Type.String;
        }
        if (valueListKey[0] === 'string' && valueListKey[1] !== fallbackKey &&
            coin(this._untypedStringProbability, this._rng))
            valueListKey = ['string', fallbackKey];

        let valueList = await this._loader.get(valueListKey);
        if (valueList.size === 0) {
            if (this._debug)
                this._warn('novalue:token:' + token, `Found no values for ${token}, falling back to ${fallbackKey}`);

            valueList = await this._loader.get(['string', fallbackKey]);
            if (valueList.size === 0)
                throw new Error(`Fallback value list is empty: missing required parameter list ${fallbackKey} for ${token}`);
        }

        return [valueList, type, '='];
    }

    private async _sampleParam(key : string,
                               arg : Ast.ArgumentDef|null,
                               valueList : Sampler,
                               type : Type,
                               operator : string,
                               replacedValuesSet : Set<ParameterRecord>) : Promise<ReplacementRecord|null> {
        let typeValue = undefined;
        if (type instanceof Type.Entity)
            typeValue = type.type;
        let attempts = this._numAttempts;
        while (attempts > 0) {
            const sampled = await valueList.sample(this._rng);
            let words = sampled.preprocessed.split(' ');
            words = Array.from(resampleIgnorableAndAbbreviations(this._paramLangPack, type, words, this._rng));

            if (this._cleanParameters &&
                (/[,?!.'\-_]/.test(sampled.preprocessed) || ['1', '2', '3'].includes(sampled.preprocessed)) &&
                attempts > this._numAttempts * 0.9) {
                attempts -= 1;
                continue;
            }

            if (operator === '=~') {
                const candidate = sampleString(words, this._paramLangPack, this._rng);
                if (!candidate) {
                    attempts -= 1;
                    continue;
                }

                return this._transformValue(candidate, { preprocessed: candidate, value: candidate, weight: 1.0 }, arg);
            }

            if (!type.isNumeric()) {
                if ((this._paramLangPack.isGoodPersonName(sampled.preprocessed)) ||
                    (this._paramLangPack.isGoodUserName(sampled.preprocessed) && typeValue && typeValue === "tt:username"))
                    return { sentenceValue: sampled.preprocessed, programValue: sampled };
                if (words.some((w) => !this._paramLangPack.isGoodWord(w)) || words.length > this._maxSpanLength) {
                    attempts -= 1;
                    continue;
                }
                if (!this._paramLangPack.isGoodSentence(sampled.preprocessed)) {
                    attempts -= 1;
                    continue;
                }
            }

            return this._transformValue(sampled.preprocessed, sampled, arg);
        }
        this._warn(`failreplace:${key}`, `Could not replace ${key} even after ${this._numAttempts}`);
        return null;
    }

    private async _replaceTokensInSentence(id : string,
                                           sentence : string[],
                                           parameters : Map<string, Ast.AbstractSlot>,
                                           replacements : Map<string, ReplacementRecord>) {
        const output : string[] = [];
        const replacedValueSet = new Set<ParameterRecord>();
        for (const record of replacements.values())
            replacedValueSet.add(record.programValue);

        for (const token of sentence) {
            if (replacements.has(token)) {
                output.push(replacements.get(token)!.sentenceValue);
            } else if (isReplaceToken(token)) {
                let key, arg = null, valueList, type, operator;
                const slot = parameters.get(token);
                if (slot) {
                    key = `${slot.tag}:${slot.type}`;
                    [valueList, arg, type, operator] = await this._getValueListForSlot(slot);
                } else {
                    if (tokenCanAppearInSentence(token)) {
                        // ignore this: we might have decided not to replace the parameter
                        output.push(token);
                        continue;
                    } else {
                        // this is probably a token that appears in the sentence but not
                        // in the program (this happens with boolean questions)
                        // try to replace it anyway without slot information
                        key = token;
                        [valueList, type, operator] = await this._getValueListForToken(token);
                    }
                }
                const replace = await this._sampleParam(key, arg, valueList, type, operator, replacedValueSet);
                if (!replace) {
                    output.push(token);
                } else {
                    replacements.set(token, replace);
                    output.push(replace.sentenceValue);
                }
            } else {
                output.push(token);
            }
        }
        return output;
    }

    private _replaceTokensInProgram(program : string[], replacements : Map<string, ReplacementRecord>) {
        const output : string[] = [];
        for (const token of program) {
            if (replacements.has(token)) {
                const programValue = replacements.get(token)!.programValue;
                const string = programValue.preprocessed;
                const value = programValue.value;

                if (token.startsWith('LOCATION_')) {
                    output.push('new', 'Location', '(', '"', string, '"', ')');
                } else if (token.startsWith('GENERIC_ENTITY_')) {
                    if (this._includeEntityValue && value)
                        output.push('"', value, '"');
                    else
                        output.push('null');
                    output.push('^^' + token.substring('GENERIC_ENTITY_'.length, token.length-2), '(', '"', string, '"', ')');
                } else if (token.startsWith('NUMBER_')) {
                    output.push(string);
                } else {
                    output.push('"', string, '"');
                }

                if (token.startsWith('HASHTAG_'))
                    output.push('^^tt:hashtag');
                else if (token.startsWith('USERNAME_'))
                    output.push('^^tt:username');
                else if (token.startsWith('PHONE_NUMBER_'))
                    output.push('^^tt:phone_number');
            } else {
                assert(!token.startsWith('SLOT_'));
                output.push(token);
            }
        }
        return output;
    }

    private _replaceWithSlot(code : string[], entities : EntityMap) {
        let counter = 0;
        let inDate = false;
        const out = [];
        for (let i = 0; i < code.length; i++) {
            const token = code[i];

            // inside `new Date` or `new Time`, do not replace token
            if (token === 'Date' || token === 'Time')
                inDate = true;
            if (inDate === true && token === ')')
                inDate = false;
            if (!inDate && isReplaceToken(token)) {
                const slot = `SLOT_${counter++}`;

                const [,entityType, number] = /^(.*)_([0-9]+)$/.exec(token)!;
                let escaped = entityType.replace(/[:._]/g, (match) => {
                    if (match === '_')
                        return '__';
                    const code = match.charCodeAt(0);
                    return code < 16 ? '_0' + code.toString(16) : '_' + code.toString(16);
                });
                escaped += '_' + number;
                if (i < code.length - 1 && token.startsWith('NUMBER_') &&
                    isUnitName(code[i+1])) {
                    const next = code[i+1];
                    escaped = escaped + '__' + (next.startsWith('unit:') ? next.substring('unit:'.length) : next);
                    i++;
                }

                const varref : ConstantValue = new Ast.Value.VarRef(`__const_${escaped}`);
                varref.token = token;
                entities[slot] = varref;
                out.push(slot);
            } else if (/^[A-Za-z_:]+_[0-9]+$/.test(token)) {
                entities[token] = makeDummyEntity(token);
                out.push(token);
            } else {
                out.push(token);
            }
        }

        return out;
    }

    private async _computeReplaceableParameters(context : string[], sentence : string[], code : string[]) {
        const parameters = new Map<string, Ast.AbstractSlot>();
        const contextEntities = new Set<string>();
        for (const token of context) {
            if (isReplaceToken(token))
                contextEntities.add(token);
        }

        const sentenceEntities = new Set<string>();
        for (const token of sentence) {
            if (isReplaceToken(token))
                sentenceEntities.add(token);
        }

        const entities : EntityMap = {};
        // replace all entities with SLOT_*, which allows us to pass a VarRef instead of a real value
        const replacedCode = this._replaceWithSlot(code, entities);
        const targetProgram = await ThingTalkUtils.parsePrediction(replacedCode, entities, {
            timezone: this._timezone,
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas,
            loadMetadata: true
        }, true);

        if (context.length !== 0 && context[0] !== 'null') {
            // So this is a dialogue, has context and we can safely process the context
            const replacedContext = this._replaceWithSlot(context, entities);
            const contextProgram = await ThingTalkUtils.parsePrediction(replacedContext, entities, {
                timezone: this._timezone,
                thingpediaClient: this._tpClient,
                schemaRetriever: this._schemas,
                loadMetadata: true
            }, true);

            // Go over the context first so that target overwrites these values for common slots
            for (const slot of contextProgram.iterateSlots2()) {
                if (slot instanceof Ast.DeviceSelector)
                    continue;

                const value : ConstantValue = slot.get();
                if (isEntity(value)) {
                    if (slot.type.isAny) {
                        // ignore this parameter, it probably comes from a
                        // bookkeeping answer QUOTED_STRING_0 which we don't need to worry about
                        // because it would be never generated anyway
                        assert(contextProgram instanceof Ast.ControlCommand);
                        continue;
                    }
                    if (isReplaceType(slot.type)) {
                        assert(isReplaceToken(value.token!));
                        parameters.set(value.token!, slot);
                    }
                }
            }
        }

        // Now go over the target
        for (const slot of targetProgram.iterateSlots2()) {
            if (slot instanceof Ast.DeviceSelector)
                continue;

            const value : ConstantValue = slot.get();
            if (isEntity(value)) {
                if (slot.type.isAny) {
                    // ignore this parameter, it probably comes from a
                    // bookkeeping answer QUOTED_STRING_0 which we don't need to worry about
                    // because it would be never generated anyway
                    assert(targetProgram instanceof Ast.ControlCommand);
                    continue;
                }
                if (isReplaceType(slot.type)) {
                    assert(isReplaceToken(value.token!));
                    parameters.set(value.token!, slot);
                }
            }
        }

        for (const token of parameters.keys()) {
            // parameters that are present:
            // - both in the context and in the sentence: replaced so we understand whatever the user says, regardless of what's the real entity is
            // - only in the context: not replaced (copied over from context)
            // - only in the sentence: replaced (new entity, easy case)
            // - neither: warning (bug) + not replaced
            if (contextEntities.has(token) && !sentenceEntities.has(token)) {
                parameters.delete(token);
                continue;
            }

            if (tokenCanAppearInSentence(token)) {
                // with some probability, we leave the parameter quoted
                // this ensures that some sentences are trained with quotes too
                // which is useful because quoted sentences are more reliable
                // in the face of unks
                // we only do this for those entities that can be extracted with
                // the tokenizer (QUOTED_STRING, HASHTAG and USERNAME)
                if (this._quotedProbability > 0 && coin(this._quotedProbability, this._rng))
                    parameters.delete(token);
            }
        }

        return parameters;
    }

    async process(example : SentenceExample) : Promise<SentenceExample[]> {
        const sentence = example.preprocessed.split(' ');
        const programs : string[][] = [];
        if (!Array.isArray(example.target_code))
            example.target_code = [example.target_code];
        for (const target_code of example.target_code)
            programs.push(target_code.split(' '));

        const parameters = await this._computeReplaceableParameters(example.context ? example.context.split(' '): [], sentence, programs[0]);

        const promises : Array<Promise<SentenceExample>> = [];
        for (let i = 0; i < this._blowupFactor(example, parameters); i++) {
            promises.push((async () => {
                const replacements = new Map();

                const newSentence = (await this._replaceTokensInSentence(example.id, sentence, parameters, replacements)).join(' ');
                const newPrograms : string[] = [];
                for (const program of programs)
                    newPrograms.push(this._replaceTokensInProgram(program, replacements).join(' '));
                let newFlags : SentenceFlags;

                if (this._addFlag) {
                    newFlags = {};
                    if (example.flags)
                        Object.assign(newFlags, example.flags);
                    newFlags.replaced = true;
                } else {
                    newFlags = example.flags || {};
                }

                return {
                    id: example.id + '-' + i,
                    type: example.type,
                    flags: newFlags,
                    context: example.context,
                    utterance: example.utterance,
                    preprocessed: newSentence,
                    target_code: newPrograms,
                    replacements: replacements
                };
            
            })());
        }
        return Promise.all(promises);
    }
}
