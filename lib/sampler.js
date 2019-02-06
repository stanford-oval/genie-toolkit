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
const Type = ThingTalk.Type;

const { coin, uniform, choose } = require('./random');

class UnassignableEntity extends Error {}
class SkippedEntity extends Error {}

const TYPES = {
    QUOTED_STRING: Type.String,
    NUMBER: Type.Number,
    CURRENCY: Type.Currency,
    DURATION: Type.Measure('ms'),
    LOCATION: Type.Location,
    DATE: Type.Date,
    TIME: Type.Time,

    EMAIL_ADDRESS: Type.Entity('tt:email_address'),
    PHONE_NUMBER: Type.Entity('tt:phone_number'),
    HASHTAG: Type.Entity('tt:hashtag'),
    USERNAME: Type.Entity('tt:username'),
    URL: Type.Entity('tt:url'),
    PATH_NAME: Type.Entity('tt:path_name'),
};

function entityTypeToTTType(entityType, unit) {
    if (entityType === 'NUMBER' && !!unit)
        return Type.Measure(unit);
    else if (entityType.startsWith('GENERIC_ENTITY_'))
        return Type.Entity(entityType.substring('GENERIC_ENTITY_'.length));
    else
        return TYPES[entityType];
}

function makeLookupKeys(deviceFunctionName, param, type) {
    const keys = [];
    keys.push(String(type));
    if (param)
        keys.push(`param:${param}:${type}`);
    if (param && deviceFunctionName) {
        const dot = deviceFunctionName.lastIndexOf('.');
        const deviceName = deviceFunctionName.substring(0, dot);
        const functionName = deviceFunctionName.substring(dot+1);

        keys.push(`param:${deviceName}.*:${param}:${type}`);
        keys.push(`param:${deviceName}.${functionName}:${param}:${type}`);
    }
    keys.reverse();
    return keys;
}

const DETOKENIZERS = {
    en: {
        // tokens that are treated specially by the PTB tokenizer for English
        SPECIAL_TOKENS: {
            '.': '.',
            ',': ',',
            'n\'t': 'n\'t',
            '\'s': '\'s',
            '?': '?',

            // right/left round/curly/square bracket
            '-rrb-': ')',
            '-lrb-': ' (',
            '-rcb-': '}',
            '-lcb-': ' {',
            '-rsb-': ']',
            '-lsb-': ' [',
        },

        detokenize(sentence, prevtoken, token) {
            if (token in this.SPECIAL_TOKENS) {
                sentence += this.SPECIAL_TOKENS[token];
            } else if ((token === 'not' && prevtoken === 'can') ||
                ((token === 'na' || token === 'ta') && prevtoken === 'gon')) {
                // PTB tokenizer does the following
                // cannot -> can not
                // gonna -> gon na
                // gotta -> got ta
                // invert it here
                //
                // note the absence of a space
                sentence += token;
            } else {
                if (sentence)
                    sentence += ' ';
                sentence += token;
            }
            return sentence;
        }
    },

    zh: {
        detokenize(buffer, prevtoken, token) {
            // join without space
            return buffer + token;
        }
    }
};

class SentenceProcessor {
    constructor(constants, detokenizer, options, id, sentence, targetCode) {
        this._constants = constants;
        this._detokenizer = detokenizer;
        this._functionBlackList = options.functionBlackList;
        this._functionWhiteList = options.functionWhiteList;
        this._deviceWhiteList = options.deviceWhiteList;
        this._rng = options.rng;
        this._compoundOnly = options.compoundOnly;
        this._debug = options.debug;
        this._locale = options.locale;

        this._id = id;
        this._sentence = sentence;
        this._targetCode = targetCode;

        this._assignedEntities = {};
        this._usedValues = new Set;
    }

    _entityRetriever(entity, param, functionname, unit) {
        if (this._assignedEntities[entity])
            return this._assignedEntities[entity].value;

        const underscoreindex = entity.lastIndexOf('_');
        const entitytype = entity.substring(0, underscoreindex);

        // special handling for PATH_NAME (HACK)
        if (entitytype === 'PATH_NAME' && (param === 'repo_name' || param === 'folder_name'))
            throw new SkippedEntity;

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
        if (ttType.isMeasure && entitytype !== 'DURATION')
            choices = choices.filter((c) => c.unit === unit);

        let index = parseInt(entity.substring(underscoreindex+1));
        if (choices.length > 0) {
            for (let i = 0; i < 10; i++) {
                let choice = uniform(choices, this._rng);
                let value = choice.value;

                if (entitytype === 'NUMBER' && this._assignedEntities['NUMBER_' + (index-1)] && this._assignedEntities['NUMBER_' + (index-1)].value >= value)
                    continue;
                if (entitytype === 'NUMBER' && this._assignedEntities['NUMBER_' + (index+1)] && this._assignedEntities['NUMBER_' + (index+1)].value <= value)
                    continue;
                if (!this._usedValues.has(choice.key)) {
                    let display;
                    // ignore display for measure/NUMBER, and just the value for measure/DURATION
                    if (ttType.isMeasure) {
                        if (entitytype === 'NUMBER') {
                            display = value.toLocaleString(this._locale);
                        } else if (entitytype === 'DURATION') {
                            value = { value, unit: choice.unit };
                            display = choice.display;
                        } else {
                            throw new TypeError('???');
                        }
                    } else {
                        display = choice.display;
                    }

                    this._assignedEntities[entity] = { value, display };
                    this._usedValues.add(choice.key);
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

    process() {
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
                if (this._deviceWhiteList) {
                    const dot = token.lastIndexOf('.');
                    const deviceName = token.substring(0, dot) + '.*';
                    if (!this._deviceWhiteList.has(deviceName))
                        return null;
                }

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

        let program;
        try {
            program = ThingTalk.NNSyntax.fromNN(code, this._entityRetriever.bind(this));
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
                if (!this._assignedEntities[token])
                    throw new Error(`Missing entity ${token} (present in the sentence, not in the code)`);
                token = this._assignedEntities[token].display;
            }
            sentence = this._detokenizer.detokenize(sentence, prevtoken, token);
            prevtoken = token;
        }

        // remove flags
        const id = this._id.replace(/^R?P?S/, '');
        const depth = parseInt(id[0]);
        const sentence_length = this._sentence.length;

        return {
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
    }
}

function remove_units(code) {
    return code.replace(/unit:\S+/g, '');
}

const SAMPLING_STRATEGIES = {
    bySignature: {
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
                if (coin(0.1, options.rng))
                    chosen = [uniform(choices, options.rng)];
            }

            if (options.debug)
                console.log('produced for ' + signature.join('+') + ' : ' + chosen.length);
            return chosen;
        }
    },

    byCode: {
        collect(bags, input, result) {
            let unified = remove_units(input.target.code);
            if (!bags.has(unified))
                bags.set(unified, []);
            bags.get(unified).push(result);
        },

        sample(key, choices, options) {
            return choose(choices, 1, options.rng);
        }
    }
};

module.exports = class SentenceSampler extends Stream.Transform {
    constructor(constants, options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });
        this._constants = constants;

        this._options = options;
        if (!this._options.functionHighValueList)
            this._options.functionHighValueList = new Set;
        if (!this._options.functionBlackList)
            this._options.functionBlackList = new Set;

        const language = options.locale.split('-')[0];
        this._detokenizer = DETOKENIZERS[language];
        if (!this._detokenizer)
            throw new Error(`Unsupported language ${language}`);

        this._samplingBags = new Map;

        this._samplingStrategy = SAMPLING_STRATEGIES[options.samplingStrategy || 'bySignature'];
        if (!this._samplingStrategy)
            throw new TypeError(`Invalid sampling strategy ${options.samplingStrategy}`);
    }

    _transform(input, encoding, callback) {
        const { id, utterance, target_code } = input;
        const processor = new SentenceProcessor(this._constants, this._detokenizer, this._options, id, utterance, target_code);

        const result = processor.process();
        if (result === null) {
            callback();
            return;
        }

        this._samplingStrategy.collect(this._samplingBags, input, result);
        callback();
    }

    _flush(callback) {
        for (let [sig, choices] of this._samplingBags) {
            if (choices.length === 0)
                continue;

            const chosen = this._samplingStrategy.sample(sig, choices, this._options);
            for (let c of chosen)
                this.push(c);
        }

        callback();
    }
};
