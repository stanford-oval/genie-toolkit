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


import Stream from 'stream';

import * as Tp from 'thingpedia';
import { SchemaRetriever } from 'thingtalk';

import { coin, uniform, choose } from '../../utils/random';
import { entityTypeToTTType, makeLookupKeys } from './sample-utils';
import * as I18n from '../../i18n';
import { SentenceExample } from '../parsers';
import { AnyEntity } from '../../utils/entity-utils';
import * as ThingTalkUtils from '../../utils/thingtalk';

class UnassignableEntity extends Error {}
class SkippedEntity extends Error {}

interface Constant {
    key : string;
    value : AnyEntity;
    display : string;
    unit ?: string;
}

interface SentenceProcessorOptions {
    functionBlackList ?: Set<string>;
    deviceBlackList ?: Set<string>;
    functionWhiteList ?: Set<string>;
    deviceWhiteList ?: Set<string>;
    contexts ?: Map<string, string[]>;
    compoundOnly : boolean;
    locale : string;
    timezone : string;
    rng : () => number;
    debug : boolean;
}

interface SampleResult {
    id : string;
    utterance : string;
    target_code : string;
    depth : number;
    sentence_length : number;
    num_functions : number;
    num_entities : number;
    num_pp : number;
    num_filters : number;
    prim_type : string;
    function_signature : string;

    context ?: string;
    context_utterance ?: string;
    assistant_action ?: string;
}

class SentenceProcessor {
    private _tpClient : Tp.BaseClient;
    private _schemaRetriever : SchemaRetriever;
    private _constants : Record<string, Constant[]>;
    private _allContexts : Map<string, string[]>;
    private _detokenizer : (sentence : string, prevtoken : string|null, token : string) => string;
    private _functionBlackList : Set<string>|undefined;
    private _deviceBlackList : Set<string>|undefined;
    private _functionWhiteList : Set<string>|undefined;
    private _deviceWhiteList : Set<string>|undefined;
    private _rng : () => number;
    private _compoundOnly : boolean;
    private _debug : boolean;
    private _locale : string;
    private _timezone : string;

    private _id : string;
    private _context : string|null;
    private _sentence : string;
    private _targetCode : string;

    private _assignedEntities : Record<string, { value : AnyEntity, display : string }>;
    private _usedValues : Set<string>;

    constructor(tpClient : Tp.BaseClient,
                schemaRetriever : SchemaRetriever,
                constants : Record<string, Constant[]>,
                detokenizer : (sentence : string, prevtoken : string|null, token : string) => string,
                options : SentenceProcessorOptions,
                input : SentenceExample) {
        this._tpClient = tpClient;
        this._schemaRetriever = schemaRetriever;
        this._constants = constants;
        this._allContexts = options.contexts || new Map;
        this._detokenizer = detokenizer;
        this._functionBlackList = options.functionBlackList;
        this._deviceBlackList = options.deviceBlackList;
        this._functionWhiteList = options.functionWhiteList;
        this._deviceWhiteList = options.deviceWhiteList;
        this._rng = options.rng;
        this._compoundOnly = options.compoundOnly;
        this._debug = options.debug;
        this._locale = options.locale;
        this._timezone = options.timezone;

        this._id = input.id;
        this._context = input.context || null;
        this._sentence = input.preprocessed;
        this._targetCode = String(input.target_code);

        this._assignedEntities = {};
        this._usedValues = new Set;
    }

    private _entityRetriever(entity : string,
                             param : string|null,
                             functionname : string|null,
                             unit : string|null,
                             options : { forContext : boolean }) : AnyEntity {
        if (this._assignedEntities[entity])
            return this._assignedEntities[entity].value;

        const underscoreindex = entity.lastIndexOf('_');
        const entitytype = entity.substring(0, underscoreindex);

        // special handling for PATH_NAME (HACK)
        if (!options.forContext && entitytype === 'PATH_NAME' && (param === 'repo_name' || param === 'folder_name'))
            throw new SkippedEntity;

        // FIXME: makeLookupKeys always return non-Array types, there might be cases we need array types
        const ttType = entityTypeToTTType(entitytype, unit);
        const keys = makeLookupKeys(functionname, param, ttType);

        let choices : Constant[]|undefined;
        for (const key of keys) {
            if (this._constants[key]) {
                choices = this._constants[key];
                break;
            }
        }
        if (!choices)
            throw new Error('unrecognized entity type ' + entitytype);

        // special handling for NUMBER followed by a unit (measure) because the unit is chosen
        // by the construct template
        // (this is not needed for DURATION/MEASURE_* entities, which carry their own unit instead)
        if (ttType.isMeasure && entitytype === 'NUMBER')
            choices = choices.filter((c) => c.unit === unit);

        //let index = parseInt(entity.substring(underscoreindex+1));
        if (choices.length > 0) {
            for (let i = 0; i < 10; i++) {
                const choice = uniform(choices, this._rng);
                let value = choice.value;

                // checks if number are in order, disable for schema.org
                /*if (entitytype === 'NUMBER' && this._assignedEntities['NUMBER_' + (index-1)] && this._assignedEntities['NUMBER_' + (index-1)].value >= value)
                    continue;
                if (entitytype === 'NUMBER' && this._assignedEntities['NUMBER_' + (index+1)] && this._assignedEntities['NUMBER_' + (index+1)].value <= value)
                    continue;*/
                if (!this._usedValues.has(choice.key === null && choice.display ? choice.display : choice.key)) {
                    let display;
                    // ignore display for measure/NUMBER, and just the value for measure/DURATION
                    if (ttType.isMeasure) {
                        if (entitytype === 'NUMBER') {
                            display = value!.toLocaleString(this._locale);
                        } else if (entitytype === 'DURATION' || entitytype.startsWith('MEASURE_')) {
                            value = { value: value as number, unit: choice.unit! };
                            if (choice.display)
                                display = choice.display;
                            else
                                display = value.value.toLocaleString(this._locale) + ' ' + choice.unit;
                        } else {
                            throw new TypeError('???');
                        }
                    } else {
                        display = choice.display;
                    }

                    this._assignedEntities[entity] = { value, display };
                    this._usedValues.add(choice.key === null && choice.display ? choice.display : choice.key);
                    return value;
                }
            }
        }

        throw new UnassignableEntity(`Run out of values for ${entity} (unit ${unit}, param name ${param})`);
    }

    private _filteredByHeuristics(code : string[]) {
        // catch gmail reply and twitter retweet
        let hasGmailInbox = false;
        for (let i = 0; i < code.length; i++) {
            const token = code[i];
            if (token === '@com.gmail.inbox') {
                hasGmailInbox = true;
                continue;
            }
            if (hasGmailInbox &&
                 (token === '@com.gmail.send_email' || token === '@com.gmail.send_picture'))
                return true;
        }

        let hasTweetInbox = false;
        for (let i = 0; i < code.length; i++) {
            const token = code[i];
            if (token === '@com.twitter.search' || token === '@com.twitter.home_timeline' || token === '@com.twitter.my_tweets') {
                hasTweetInbox = true;
                continue;
            }
            if (hasTweetInbox &&
                 (token === '@com.twitter.post' || token === '@com.twitter.post_picture'))
                return true;
        }
        return false;
    }

    async process() : Promise<SampleResult|null> {
        const code = this._targetCode;

        const tokens = code.split(' ');
        if (this._filteredByHeuristics(tokens))
            return null;

        let num_pp = 0;
        let num_filters = 0;
        const functions = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            if (token.startsWith('@') && token !== '@org.thingpedia.builtin.thingengine.builtin.say') {
                if (this._functionBlackList && this._functionBlackList.has(token))
                    return null;
                if (this._functionWhiteList && !this._functionWhiteList.has(token))
                    return null;

                const dot = token.lastIndexOf('.');
                const deviceName = token.substring(0, dot) + '.*';
                if (this._deviceBlackList && this._deviceBlackList.has(deviceName))
                    return null;
                if (this._deviceWhiteList && !this._deviceWhiteList.has(deviceName))
                    return null;

                functions.push(token);
            }
            if (token.startsWith('param:')
                && i < tokens.length -2 &&
                tokens[i+1] === '=' &&
                tokens[i+2].startsWith('param:'))
                num_pp++;
            if (token.startsWith('param:')
                && i < tokens.length -1
                && ['==', '>=', '<=', '=~', '!=', 'contains', 'in_array', 'starts_with', 'ends_with'].indexOf(tokens[i+1]) >= 0
                && i >= 2
                && !tokens[i-2].startsWith('param:'))
                num_filters++;
        }
        const function_signature = functions.join('+');
        const num_functions = functions.length;
        if (this._compoundOnly && num_functions < 2)
            return null;
        let prim_type = 'compound';
        if (num_functions < 2) {
            if (tokens[0] === 'now' && tokens[tokens.length - 1] !== 'notify')
                prim_type = 'action';
            else
                prim_type = 'query';
        }

        let context = null;
        if (this._context !== null) {
            const contexts = this._allContexts.get(this._context);
            if (!contexts || contexts.length === 0) {
                if (this._debug)
                    console.log(`Skipped ${this._id} because the context is not known`);
                return null;
            }

            try {
                const entityResolver = ((entity : string, param : string|null, functionname : string|null, unit : string|null) =>
                    this._entityRetriever(entity, param, functionname, unit, { forContext: true }));
                context = await ThingTalkUtils.parsePrediction(this._context.split(' '), entityResolver, {
                    timezone: this._timezone,
                    thingpediaClient: this._tpClient,
                    schemaRetriever: this._schemaRetriever
                }, true);
            } catch(e) {
                if (e instanceof SkippedEntity)
                    return null;
                if (!(e instanceof UnassignableEntity))
                    throw e;
                if (this._debug)
                    console.log(`Skipped ${this._id} due to context: ${e.message}`);
                return null;
            }
        }

        let program;
        try {
            const entityResolver = ((entity : string, param : string|null, functionname : string|null, unit : string|null) =>
                this._entityRetriever(entity, param, functionname, unit, { forContext: false }));
            program = await ThingTalkUtils.parsePrediction(tokens, entityResolver, {
                timezone: this._timezone,
                thingpediaClient: this._tpClient,
                schemaRetriever: this._schemaRetriever
            }, true);
        } catch(e) {
            if (e instanceof SkippedEntity)
                return null;
            if (!(e instanceof UnassignableEntity))
                throw e;
            if (this._debug)
                console.log(`Skipped ${this._id}: ${e.message}`);
            return null;
        }

        let sentence = '';
        let prevtoken = null;
        let num_entities = 0;
        for (let token of this._sentence.split(' ')) {
            // replace entities and undo penn tree bank tokenization
            if (/^[A-Z]/.test(token)) { // entity
                num_entities ++;

                if (!this._assignedEntities[token]) {
                    console.error(this._sentence);
                    throw new Error(`Missing entity ${token} (present in the sentence, not in the code)`);
                }
                token = this._assignedEntities[token].display;
            }
            sentence = this._detokenizer(sentence, prevtoken, token);
            prevtoken = token;
        }

        let context_utterance = '';
        const assistant_action = ''; // FIXME
        if (context !== null) {
            let prevtoken = null;
            const choices = this._allContexts.get(this._context!)!;
            for (let token of uniform(choices, this._rng).split(' ')) {
                // replace entities and undo penn tree bank tokenization
                if (/^[A-Z]/.test(token)) { // entity
                    if (!this._assignedEntities[token]) {
                        console.log(this._context, this._targetCode, this._assignedEntities);
                        throw new Error(`Missing entity ${token} (present in the context sentence, not in the context code)`);
                    }
                    token = this._assignedEntities[token].display;
                }
                context_utterance = this._detokenizer(context_utterance, prevtoken, token);
                prevtoken = token;
            }
        }

        // remove flags
        const id = this._id.replace(/^R?P?S/, '');
        const depth = parseInt(id[0]);
        const sentence_length = this._sentence.length;

        const obj : SampleResult = {
            id: this._id,
            utterance: sentence,
            target_code: program.prettyprint(),
            depth: depth,
            sentence_length,
            num_functions,
            num_entities,
            num_pp,
            num_filters,
            prim_type,
            function_signature,
        };
        if (context !== null) {
            obj.context = context.prettyprint();
            obj.context_utterance = context_utterance;
            obj.assistant_action = assistant_action;
        }
        return obj;
    }
}

function remove_units(code : string) : string {
    return code.replace(/unit:\S+/g, '');
}

interface SampleOptions {
    rng : () => number;
    debug : boolean;
    functionHighValueList ?: Set<string>;
}

interface SamplingStrategy<StateType> {
    init() : StateType;
    iterate(state : StateType) : Iterable<[string, SampleResult[]]>;
    collect(state : StateType, input : SentenceExample, result : SampleResult, options : SampleOptions) : void;
    sample(key : string, choices : SampleResult[], options : SampleOptions) : SampleResult[];
}

interface BySentenceSampleState {
    s : number;
    sentences : string[];
    bags : Map<string, SampleResult[] & { n : number }>;
}

const SAMPLING_STRATEGIES : {
    bySignature : SamplingStrategy<Map<string, SampleResult[]>>;
    byCode : SamplingStrategy<Map<string, SampleResult[]>>;
    bySentence : SamplingStrategy<BySentenceSampleState>;
} = {
    bySignature: {
        init() : Map<string, SampleResult[]> {
            return new Map;
        },

        iterate(bags : Map<string, SampleResult[]>) : Iterable<[string, SampleResult[]]> {
            return bags;
        },

        collect(bags : Map<string, SampleResult[]>,
                input : SentenceExample,
                result : SampleResult) : void {
            const functionsig = result.function_signature;
            if (!bags.has(functionsig))
                bags.set(functionsig, []);
            bags.get(functionsig)!.push(result);
        },

        sample(sig : string, choices : SampleResult[], options : SampleOptions) : SampleResult[] {
            const signature = sig.split('+');

            let chosen : SampleResult[] = [];
            if (signature.length === 1) {
                if (choices[0].prim_type === 'query') {
                    if (options.debug)
                        console.log('primitive query: ' + signature[0] + ' ' + choices.length);
                    chosen = choose(choices, 50, options.rng);
                } else {
                    if (options.debug)
                        console.log('primitive action: ' + signature[0] + ' ' + choices.length);
                    chosen = choose(choices, 20, options.rng);
                }
            } else if (signature.length === 2) {
                if (signature[0] === signature[1])
                    return [];
                if (signature.every((sig) => options.functionHighValueList && options.functionHighValueList.has(sig))) {
                    if (options.debug)
                        console.log('high value compound: ' + signature.join('+') + ' ' + choices.length);

                    chosen = choose(choices, 10, options.rng);
                } else if (signature.some((sig) => options.functionHighValueList && options.functionHighValueList.has(sig))) {
                    if (options.debug)
                        console.log('mid value compound: ' + signature.join('+') + ' ' + choices.length);
                    chosen = choose(choices, 1, options.rng);
                } else {
                    if (options.debug)
                        console.log('low value compound: ' + signature.join('+') + ' ' + choices.length);
                    if (coin(0.05, options.rng))
                        chosen = [uniform(choices, options.rng)];
                }
            } else if (signature.length === 3) {
                if (coin(0.5, options.rng))
                    chosen = [uniform(choices, options.rng)];
            }

            if (options.debug)
                console.log('produced for ' + signature.join('+') + ' : ' + chosen.length);
            return chosen;
        }
    },

    byCode: {
        init() : Map<string, SampleResult[]> {
            return new Map;
        },

        iterate(bags : Map<string, SampleResult[]>) : Iterable<[string, SampleResult[]]> {
            return bags;
        },

        collect(bags : Map<string, SampleResult[]>,
                input : SentenceExample,
                result : SampleResult) : void {
            const unified = remove_units(String(input.target_code));
            if (!bags.has(unified))
                bags.set(unified, []);
            bags.get(unified)!.push(result);
        },

        sample(key : string, choices : SampleResult[], options : SampleOptions) : SampleResult[] {
            return choose(choices, 3, options.rng);
        }
    },

    bySentence: {
        init() : BySentenceSampleState {
            return {
                s: 0,
                sentences: [],
                bags: new Map
            };
        },

        iterate(state : BySentenceSampleState) : Iterable<[string, SampleResult[]]> {
            return state.bags;
        },

        collect(state : BySentenceSampleState,
                input : SentenceExample,
                result : SampleResult,
                options : SampleOptions) : void {
            const sentences = state.sentences;
            const bags = state.bags;

            const newSentence = input.preprocessed;

            let bag = bags.get(newSentence);
            if (!bag) {
                const newBag = [] as SampleResult[] as (SampleResult[] & { n : number });
                newBag.n = 0;
                bag = newBag;

                if (sentences.length < 20000) {
                    sentences.push(newSentence);
                    bags.set(newSentence, bag);
                } else if (coin(20000/state.s, options.rng)) {
                    const i = Math.floor(options.rng()*20000);
                    const toDelete = sentences[i];
                    bags.delete(toDelete);
                    sentences[i] = newSentence;
                } else {
                    // drop this sentence on the floor
                    state.s ++;
                    return;
                }

                bags.set(newSentence, newBag);
                state.s ++;
            }
            const bag2 = bag!;

            if (bag2.length < 3) {
                bag2.push(result);
            } else if (coin(3/bag2.n, options.rng)) {
                const i = Math.floor(options.rng()*3);
                bag2[i] = result;
            }

            bag2.n ++;
        },

        sample(key : string, choices : SampleResult[], options : SampleOptions) : SampleResult[] {
            return choices;//choose(choices, 3, options.rng);
        }
    }
};

interface SentenceSamplerOptions {
    samplingStrategy ?: keyof typeof SAMPLING_STRATEGIES;
    functionHighValueList ?: Set<string>;
    functionBlackList ?: Set<string>;
    deviceBlackList ?: Set<string>;
    functionWhiteList ?: Set<string>;
    deviceWhiteList ?: Set<string>;
    compoundOnly : boolean;
    locale : string;
    timezone : string;
    rng : () => number;
    debug : boolean;
}

interface SampledExample {
    id : string;
    utterance ?: string;
    target_code ?: string;
    context ?: string;
    context_utterance ?: string;
    assistant_action ?: string;
}

export default class SentenceSampler extends Stream.Transform {
    private _tpClient : Tp.BaseClient;
    private _schemaRetriever : SchemaRetriever;
    private _constants : Record<string, Constant[]>;
    private _options : SentenceSamplerOptions;
    private _samplingStrategy : SamplingStrategy<any>;
    private _samplingState : any;
    private _detokenizer : (sentence : string, prevtoken : string|null, token : string) => string

    constructor(tpClient : Tp.BaseClient,
                schemaRetriever : SchemaRetriever,
                constants : Record<string, Constant[]>,
                options : SentenceSamplerOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });
        this._constants = constants;
        this._tpClient = tpClient;
        this._schemaRetriever = schemaRetriever;

        this._options = options;
        if (!this._options.functionHighValueList)
            this._options.functionHighValueList = new Set;

        this._detokenizer = I18n.get(options.locale).detokenize;

        this._samplingStrategy = SAMPLING_STRATEGIES[options.samplingStrategy || 'bySignature'];
        if (!this._samplingStrategy)
            throw new TypeError(`Invalid sampling strategy ${options.samplingStrategy}`);
        this._samplingState = this._samplingStrategy.init();
    }

    private async _run(input : SentenceExample) {
        const processor = new SentenceProcessor(this._tpClient, this._schemaRetriever, this._constants, this._detokenizer, this._options, input);

        const result = await processor.process();
        if (result === null)
            return;

        this._samplingStrategy.collect(this._samplingState, input, result, this._options);
    }

    _transform(input : SentenceExample, encoding : BufferEncoding, callback : (err ?: Error) => void) {
        this._run(input).then(() => callback(), callback);
    }

    _flush(callback : () => void) {
        for (const [sig, choices] of this._samplingStrategy.iterate(this._samplingState)) {
            if (choices.length === 0)
                continue;

            const chosen = this._samplingStrategy.sample(sig, choices, this._options);
            for (const c of chosen) {
                const ret : SampledExample = {
                    id: c.id
                };
                if (c.context) {
                    ret.context = c.context;
                    ret.context_utterance = c.context_utterance;
                    ret.assistant_action = c.assistant_action;
                }
                ret.utterance = c.utterance;
                ret.target_code = c.target_code;
                this.push(ret);
            }
        }

        callback();
    }
}
