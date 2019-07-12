// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');

const { coin, uniform, categorical } = require('./random');
const binarySearch = require('./binary_search');
const i18n = require('./i18n');

function isGoodWord(word) {
    // filter out words that cannot be in the dataset,
    // because they would be either tokenized/preprocessed out or
    // they are unlikely to be used with voice
    return /^([a-zA-Z0-9-][a-zA-Z0-9.-]*|'s|\?)$/.test(word);
}
function isGoodSentence(sentence) {
    return !/^(the|a|has|for|title|when|me|i|so|--)$/.test(sentence);
}

function isReplaceToken(tok) {
    return /^(?:GENERIC_ENTITY_|LOCATION_|QUOTED_STRING_|HASHTAG_|USERNAME_)/.test(tok);
}

function adjustForLength(sentence, weight) {
    const length = sentence.split(' ').length;
    return weight / Math.exp((length-1)/3);
}

class WeightedValueList {
    constructor(values, weights) {
        assert.strictEqual(values.length, weights.length);

        this._values = values;

        if (weights.length > 0) {
            const cumsum = new Array(weights.length);
            cumsum[0] = adjustForLength(values[0], weights[0]);
            for (let i = 1; i < weights.length; i++)
                cumsum[i] = cumsum[i-1] + adjustForLength(values[i], weights[i]);
            this._cumsum = cumsum;
        } else {
            this._cumsum = [];
        }
    }

    get size() {
        return this._values.length;
    }

    sample(rng) {
        const sample = rng() * this._cumsum[this._cumsum.length-1];
        return this._values[binarySearch(this._cumsum, sample)];
    }
}

class UniformValueList {
    constructor(values) {
        this._values = values;
    }

    get size() {
        return this._values.length;
    }

    sample(rng) {
        return uniform(this._values, rng);
    }
}

class ValueListLoader {
    constructor(provider) {
        this._provider = provider;

        this._emptyList = new UniformValueList([]);
        this._cache = new Map;
    }

    get([valueListType, valueListName]) {
        if (valueListType === null && valueListName === null)
            return this._emptyList;
        const key = valueListType + ':' + valueListName;
        if (this._cache.has(key))
            return this._cache.get(key);

        const promise = this._load(valueListType, valueListName);
        this._cache.set(key, promise);
        return promise;
    }

    async _load(valueListType, valueListName) {
        const rows = await this._provider.get(valueListType, valueListName);

        let minWeight = Infinity, maxWeight = -Infinity;
        let sumWeight = 0;
        for (let row of rows) {
            minWeight = Math.min(row.weight, minWeight);
            maxWeight = Math.max(row.weight, maxWeight);
            sumWeight += row.weight;
        }

        // if all weights are approximately equal
        // (ie, the range is significantly smaller than the average)
        // we use a uniform sampler, which is faster
        if ((maxWeight - minWeight) / (sumWeight / rows.length) < 0.0001)
            return new UniformValueList(rows.map((r) => r.preprocessed));
        else
            return new WeightedValueList(rows.map((r) => r.preprocessed), rows.map((r) => r.weight));
    }
}

const OPERATORS = new Set(['==', '=', '=~', '~=', 'in_array', 'contains', 'starts_with', 'ends_with', '>=', '<=']);

function *resampleIgnorableAndAbbreviations(langPack, ptype, sentence, rng) {
    if (!ptype.isEntity) {
        yield *sentence;
        return;
    }
    const ignorable = ptype.type.startsWith('sportradar') ? langPack.IGNORABLE_TOKENS['sportradar'] : (langPack.IGNORABLE_TOKENS[ptype.type] || []);

    for (let word of sentence) {
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

function _default(v, def) {
    if (v === undefined)
        return def;
    else
        return v;
}

module.exports = class ParameterReplacer {
    constructor(schemas, constProvider, options) {
        this._schemas = schemas || null;
        this._loader = new ValueListLoader(constProvider);
        this._rng = _default(options.rng, Math.random);
        this._addFlag = _default(options.addFlag, false);
        this._langPack = i18n.get(options.locale);
        this._quotedProbability = _default(options.quotedProbability, 0.1);
        this._untypedStringProbability = _default(options.untypedStringProbability, 0.01);
        this._maxSpanLength = _default(options.maxSpanLength, 10);
        this._replaceLocations = _default(options.replaceLocations, true);
        
        this._blowUpSynthetic = _default(options.syntheticExpandFactor, 5);
        this._blowUpNoQuote = _default(options.noQuoteExpandFactor, 10);
        this._blowUpParaphrasing = _default(options.paraphrasingExpandFactor, 30);
        this._blowUpAugmented = Math.floor(this._blowUpParaphrasing/2);

        this._warned = new Set;
    }
    
    _blowupFactor(example, params) {
        if (example.flags.synthetic)
            return this._blowUpSynthetic;
        if (params.size === 0)
            return this._blowUpNoQuote;
        if (example.flags.augmented)
            return this._blowUpAugmented;
        return this._blowUpParaphrasing;
    }

    async _getParamListKey(fn, pname, ptype) {
        if (fn === '$source' || fn === '$executor')
            return ['string', 'tt:person_first_name'];
        while (ptype.isArray)
            ptype = ptype.elem;

        if (!ptype.isEntity && !ptype.isString && !ptype.isLocation)
            throw new TypeError(`Unexpected replaced type ${ptype}`);

        const lastDot = fn.lastIndexOf('.');
        const kind = fn.substring(0, lastDot);
        const functionName = fn.substring(lastDot+1);

        const schema = await this._schemas.getFullMeta(kind);
        const functionDef = functionName in schema.queries ?
            schema.queries[functionName] :
            schema.actions[functionName];
        if (!functionDef)
            throw new Error(`Missing function ${fn} in Thingpedia`);

        const arg = functionDef.getArgument(pname);
        if (!arg)
            throw new Error(`Function ${fn} has no argument ${pname}`);

        if (arg.annotations.string_values && arg.annotations.string_values.value)
            return ['string', arg.annotations.string_values.toJS()];

        if (ptype.isEntity)
            return this._getEntityListKey(ptype.type);

        return ['string', this._getFallbackParamListKey(pname, ptype)];
    }

    _getEntityListKey(entityType) {
        switch (entityType) {
        case 'tt:username':
        case 'tt:contact':
        case 'tt:email_address':
        case 'tt:phone_number':
            return ['string', 'tt:person_first_name'];

        case 'tt:hashtag':
            return ['string', 'tt:word'];
        case 'tt:path_name':
            return ['string', 'tt:path_name'];

        default:
            return ['entity', entityType];
        }
    }

    _getFallbackParamListKey(pname, ptype) {
        if (ptype.isEntity)
            return this._getEntityListKey(ptype.type)[1];
        if (ptype.isLocation)
            return 'tt:location';

        switch (pname) {
        case 'message':
        case 'snippet':
        case 'text':
        case 'description':
        case 'status':
        case 'body':
            return 'tt:long_free_text';

        default:
            return 'tt:short_free_text';
        }
    }

    async _sampleParam(pid) {
        const [fn, pname, ptypestr, pop] = pid.split('+');
        const ptype = ThingTalk.Type.fromString(ptypestr);

        let valueListKey = await this._getParamListKey(fn, pname, ptype);
        const fallbackKey = this._getFallbackParamListKey(pname, ptype);
        if (valueListKey[0] === 'string' && valueListKey[1] !== fallbackKey &&
            coin(this._untypedStringProbability, this._rng))
            valueListKey = ['string', fallbackKey];

        let valueList = await this._loader.get(valueListKey);
        if (valueList.size === 0) {
            if (!this._warned.has(pname + ':' + ptype)) {
                console.error(`Found no values for ${pname}:${ptype}`);
                this._warned.add(pname + ':' + ptype);
            }
            valueList = await this._loader.get(['string', fallbackKey]);
            if (valueList.size === 0)
                throw new Error(`Fallback value list is empty: missing required parameter list ${fallbackKey}`);
        }

        let attempts = 10000;
        while (attempts > 0) {
            const sampled = valueList.sample(this._rng);
            let words = sampled.split(' ');
            words = Array.from(resampleIgnorableAndAbbreviations(this._langPack, ptype, words, this._rng));

            if (pop === '=~') {
                let seq;
                if (words.length > 6) {
                    const sampledLengthIdx = categorical([0.3, 0.2, 0.1, 0.1, 0.05, 0.01], this._rng);
                    const length = [1,2,3,4,5,6][sampledLengthIdx];
                    const idx = Math.floor(this._rng() * (words.length-length));

                    seq = words.slice(idx, idx+length);
                } else if (words.length > 4) {
                    const sampledLengthIdx = categorical([0.4, 0.3, 0.2, 0.1], this._rng);
                    const length = [1,2,3,4][sampledLengthIdx];
                    const idx = Math.floor(this._rng() * (words.length-length));

                    seq = words.slice(idx, idx+length);
                } else if (words.length > 2) {
                    const sampledLengthIdx = categorical([0.5, 0.5], this._rng);
                    const length = [1,2][sampledLengthIdx];
                    const idx = Math.floor(this._rng() * (words.length-length));

                    seq = words.slice(idx, idx+length);
                } else {
                    seq = words;
                }
                if (seq.some((w) => !isGoodWord(w))) {
                    attempts -= 1;
                    continue;
                }
                const cand = seq.join(' ');
                if (!isGoodSentence(cand)) {
                    attempts -= 1;
                    continue;
                }
                return cand;
            }

            if (words.some((w) => !isGoodWord(w)) || words.length > this._maxSpanLength) {
                attempts -= 1;
                continue;
            }
            if (!isGoodSentence(sampled)) {
                attempts -= 1;
                continue;
            }

            return sampled;
        }

        return null;
    }

    async _replaceTokensInSentence(id, sentence, parameters, replacements) {
        let output = [];

        for (let token of sentence) {
            if (replacements.has(token)) {
                output.push(replacements.get(token));
            } else if (isReplaceToken(token)) {
                if (!parameters.has(token)) {
                    // ignore this: we might have decided not to replace the parameter
                    output.push(token);
                    continue;
                }
                const replace = await this._sampleParam(parameters.get(token));
                if (!replace) {
                    output.push(token);
                } else {
                    replacements.set(token, replace);
                    output.push(replace);
                }
            } else {
                output.push(token);
            }
        }
        return output;
    }

    _replaceTokensInProgram(program, replacements) {
        let output = [];
        for (let token of program) {
            if (replacements.has(token)) {
                if (token.startsWith('LOCATION_'))
                    output.push('location:');
                output.push('"', replacements.get(token), '"');
                if (token.startsWith('HASHTAG_'))
                    output.push('^^tt:hashtag');
                else if (token.startsWith('USERNAME_'))
                    output.push('^^tt:username');
                else if (token.startsWith('GENERIC_ENTITY_'))
                    output.push('^^' + token.substring('GENERIC_ENTITY_'.length, token.length-2));
            } else {
                output.push(token);
            }
        }
        return output;
    }

    _computeReplaceableParameters(context, sentence, program) {
        const parameters = new Map;
        const contextEntities = new Set;
        for (let token of context) {
            if (isReplaceToken(token))
                contextEntities.add(token);
        }

        let curFn = [];
        let curParam = null;
        let curOp = null;
        for (let token of program) {
            if (['join', '=>'].indexOf(token) >= 0) {
                curFn = [];
            } else if (token.startsWith('@')) {
                curFn.push(token.substring(1));
            } else if (token === '}') {
                curFn.pop();
            } else if (token.startsWith('param:')) {
                curParam = token.substring('param:'.length);
                let colonIndex = curParam.indexOf(':');
                let curType = curParam.substring(colonIndex+1);
                curParam = curParam.substring(0, colonIndex);
                curParam = curParam + '+' + curType;
                curOp = null;
            } else if (token === 'executor') {
                curFn.push('$executor');
                curParam = 'executor+Entity(tt:contact)';
            } else if (OPERATORS.has(token)) {
                curOp = token;
            } else if (isReplaceToken(token) && !contextEntities.has(token)) {
                if (token.startsWith('LOCATION_') && !this._replaceLocations)
                    continue;

                if (/^(QUOTED_STRING|HASHTAG|USERNAME)_/.test(token)) {
                    // with some probability, we leave the parameter quoted
                    // this ensures that some sentences are trained with quotes too
                    // which is useful because quoted sentences are more reliable
                    // in the face of unks
                    // we only do this for QUOTED_STRING, HASHTAG and USERNAME
                    // (and not GENERIC_ENTITY) because those NER extractors are always
                    // enabled, while the GENERIC_ENTITY one is enabled or disabled
                    // in almond-tokenizer manually
                    if (this._quotedProbability > 0 && coin(this._quotedProbability, this._rng))
                        continue;
                }

                if (curFn.length === 0) {
                    if (curParam === 'source+Entity(tt:contact)')
                        parameters.set(token, '$source+' + curParam + '+' + curOp);

                    // else ignore this parameter, it probably comes from a
                    // bookkeeping answer QUOTED_STRING_0 which we don't need to worry about
                    // because it would be never generated anyway
                } else {
                    parameters.set(token, curFn[curFn.length-1] + '+' + curParam + '+' + curOp);
                }
            }
        }

        return parameters;
    }

    process(example) {
        const sentence = example.preprocessed.split(' ');
        const program = example.target_code.split(' ');

        const parameters = this._computeReplaceableParameters(example.context ? example.context.split(' '): [], sentence, program);

        const promises = [];
        for (let i = 0; i < this._blowupFactor(example, parameters); i++) {
            promises.push((async () => {
                const replacements = new Map();
                const new_sentence = (await this._replaceTokensInSentence(example.id, sentence, parameters, replacements)).join(' ');
                const new_program = (await this._replaceTokensInProgram(program, replacements)).join(' ');
                let new_flags;

                if (this._addFlag) {
                    new_flags = {};
                    if (example.flags)
                        Object.assign(new_flags, example.flags);
                    new_flags.replaced = true;
                } else {
                    new_flags = example.flags || {};
                }

                return {
                    id: example.id + '-' + i,
                    type: example.type,
                    flags: new_flags,
                    context: example.context,
                    utterance: example.utterance,
                    preprocessed: new_sentence,
                    target_code: new_program
                };
            })());
        }
        return Promise.all(promises);
    }
};
