// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');

const ThingTalk = require('thingtalk');

const { coin, uniform, choose } = require('../../utils/random');
const { entityTypeToTTType, makeLookupKeys } = require('./sample-utils');
const i18n = require('../../i18n');

class UnassignableEntity extends Error {}
class SkippedEntity extends Error {}

class SentenceProcessor {
    constructor(schemaRetriever, constants, detokenizer, options, input) {
        this._schemaRetriever = schemaRetriever;
        this._constants = constants;
        this._allContexts = options.contexts;
        this._detokenizer = detokenizer;
        this._functionBlackList = options.functionBlackList;
        this._deviceBlackList = options.deviceBlackList;
        this._functionWhiteList = options.functionWhiteList;
        this._deviceWhiteList = options.deviceWhiteList;
        this._rng = options.rng;
        this._compoundOnly = options.compoundOnly;
        this._debug = options.debug;
        this._locale = options.locale;

        this._id = input.id;
        this._context = input.context || null;
        this._sentence = input.preprocessed;
        this._targetCode = input.target_code;

        this._assignedEntities = {};
        this._usedValues = new Set;
    }

    _entityRetriever(entity, param, functionname, unit, options) {
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

        let choices;
        for (let key of keys) {
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
                let choice = uniform(choices, this._rng);
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
                            display = value.toLocaleString(this._locale);
                        } else if (entitytype === 'DURATION' || entitytype.startsWith('MEASURE_')) {
                            value = { value, unit: choice.unit };
                            if (choice.display)
                                display = choice.display;
                            else
                                display = value.toLocaleString(this._locale) + ' ' + choice.unit;
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

    _filteredByHeuristics(code) {
        // catch gmail reply and twitter retweet
        let hasGmailInbox = false;
        for (let i = 0; i < code.length; i++) {
             let token = code[i];
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
             let token = code[i];
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

    async process() {
        let code = this._targetCode;

        code = code.split(' ');

        if (this._filteredByHeuristics(code))
            return null;

        let num_pp = 0;
        let num_filters = 0;
        let functions = [];
        for (let i = 0; i < code.length; i++) {
            let token = code[i];

            if (token.startsWith('@') && token !== '@org.thingpedia.builtin.thingengine.builtin.say') {
                if (this._functionBlackList.has(token))
                    return null;
                if (this._functionWhiteList && !this._functionWhiteList.has(token))
                    return null;

                const dot = token.lastIndexOf('.');
                const deviceName = token.substring(0, dot) + '.*';
                if (this._deviceBlackList.has(deviceName))
                    return null;
                if (this._deviceWhiteList && !this._deviceWhiteList.has(deviceName))
                    return null;

                functions.push(token);
            }
            if (token.startsWith('param:')
                && i < code.length -2 &&
                code[i+1] === '=' &&
                code[i+2].startsWith('param:'))
                num_pp++;
            if (token.startsWith('param:')
                && i < code.length -1
                && ['==', '>=', '<=', '=~', '!=', 'contains', 'in_array', 'starts_with', 'ends_with'].indexOf(code[i+1]) >= 0
                && i >= 2
                && !code[i-2].startsWith('param:'))
                num_filters++;
        }
        const function_signature = functions.join('+');
        const num_functions = functions.length;
        if (this._compoundOnly && num_functions < 2)
            return null;
        let prim_type = 'compound';
        if (num_functions < 2) {
            if (code[0] === 'now' && code[code.length - 1] !== 'notify')
                prim_type = 'action';
            else
                prim_type = 'query';
        }

        let context = null;
        if (this._context !== null) {
            if (!this._allContexts.has(this._context) || this._allContexts.get(this._context).length === 0) {
                if (this._debug)
                    console.log(`Skipped ${this._id} because the context is not known`);
                return null;
            }

            try {
                context = ThingTalk.NNSyntax.fromNN(this._context.split(' '), (entity, param, functionname, unit) =>
                    this._entityRetriever(entity, param, functionname, unit, { forContext: true }));
                //await context.typecheck(this._schemaRetriever, false);
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
            program = ThingTalk.NNSyntax.fromNN(code, (entity, param, functionname, unit) =>
                this._entityRetriever(entity, param, functionname, unit, { forContext: false }));
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

        let context_utterance = '', assistant_action = null;
        if (context !== null) {
            let prevtoken = null;
            const choices = this._allContexts.get(this._context);
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

            for (let [, slot] of context.iterateSlots()) {
                if (slot instanceof ThingTalk.Ast.Selector)
                    continue;
                if (slot.value.isUndefined) {
                    assistant_action = 'slot-fill:' + slot.name;
                    break;
                }
            }
            if (assistant_action === null) {
                if (context.isProgram && context.rules.every((r) => !r.stream && r.actions.every((a) => a.isInvocation && a.invocation.selector.isBuiltin)))
                    assistant_action = 'result';
                else
                    assistant_action = 'confirm';
            }
        }

        // remove flags
        const id = this._id.replace(/^R?P?S/, '');
        const depth = parseInt(id[0]);
        const sentence_length = this._sentence.length;

        const obj = {
            id: this._id,
            utterance: sentence,
            target_code: program.prettyprint(true),
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
            obj.context = context.prettyprint(true);
            obj.context_utterance = context_utterance;
            obj.assistant_action = assistant_action;
        }
        return obj;
    }
}

function remove_units(code) {
    return code.replace(/unit:\S+/g, '');
}

const SAMPLING_STRATEGIES = {
    bySignature: {
        init() {
            return new Map;
        },

        iterate(bags) {
            return bags;
        },

        collect(bags, input, result) {
            let functionsig = result.function_signature;
            if (!bags.has(functionsig))
                bags.set(functionsig, []);
            bags.get(functionsig).push(result);
        },

        sample(sig, choices, options) {
            let signature = sig.split('+');

            let chosen = [];
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
                if (signature.every((sig) => options.functionHighValueList.has(sig))) {
                    if (options.debug)
                        console.log('high value compound: ' + signature.join('+') + ' ' + choices.length);

                    chosen = choose(choices, 10, options.rng);
                } else if (signature.some((sig) => options.functionHighValueList.has(sig))) {
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
        init() {
            return new Map;
        },

        iterate(bags) {
            return bags;
        },

        collect(bags, input, result) {
            let unified = remove_units(input.target_code);
            if (!bags.has(unified))
                bags.set(unified, []);
            bags.get(unified).push(result);
        },

        sample(key, choices, options) {
            return choose(choices, 3, options.rng);
        }
    },

    bySentence: {
        init() {
            return {
                s: 0,
                sentences: [],
                bags: new Map
            };
        },

        iterate(state) {
            return state.bags;
        },

        collect(state, input, result, options) {
            const sentences = state.sentences;
            const bags = state.bags;

            const newSentence = input.preprocessed;

            let bag = bags.get(newSentence);
            if (!bag) {
                bag = [];
                bag.n = 0;

                if (sentences.length < 20000) {
                    sentences.push(newSentence);
                    bags.set(newSentence, bag);
                } else if (coin(20000/state.s)) {
                    const i = Math.floor(options.rng()*20000);
                    const toDelete = sentences[i];
                    bags.delete(toDelete);
                    sentences[i] = newSentence;
                } else {
                    // drop this sentence on the floor
                    state.s ++;
                    return;
                }

                bags.set(newSentence, bag);
                state.s ++;
            }

            if (bag.length < 3) {
                bag.push(result);
            } else if (coin(3/bag.n)) {
                const i = Math.floor(options.rng()*3);
                bag[i] = result;
            }

            bag.n ++;
        },

        sample(key, choices, options) {
            return choices;//choose(choices, 3, options.rng);
        }
    }
};

module.exports = class SentenceSampler extends Stream.Transform {
    constructor(schemaRetriever, constants, options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });
        this._constants = constants;
        this._schemaRetriever = schemaRetriever;

        this._options = options;
        if (!this._options.functionHighValueList)
            this._options.functionHighValueList = new Set;
        if (!this._options.functionBlackList)
            this._options.functionBlackList = new Set;
        if (!this._options.deviceBlackList)
            this._options.deviceBlackList = new Set;

        this._detokenizer = i18n.get(options.locale).detokenize;

        this._samplingStrategy = SAMPLING_STRATEGIES[options.samplingStrategy || 'bySignature'];
        if (!this._samplingStrategy)
            throw new TypeError(`Invalid sampling strategy ${options.samplingStrategy}`);
        this._samplingState = this._samplingStrategy.init(this._options);
    }

    async _run(input) {
        const processor = new SentenceProcessor(this._schemaRetriever, this._constants, this._detokenizer, this._options, input);

        const result = await processor.process();
        if (result === null)
            return;

        this._samplingStrategy.collect(this._samplingState, input, result, this._options);
    }

    _transform(input, encoding, callback) {
        this._run(input).then(() => callback(), callback);
    }

    _flush(callback) {
        for (let [sig, choices] of this._samplingStrategy.iterate(this._samplingState)) {
            if (choices.length === 0)
                continue;

            const chosen = this._samplingStrategy.sample(sig, choices, this._options);
            for (let c of chosen) {
                const ret = {};
                ret.id = c.id;
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
};
