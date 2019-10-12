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
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const { coin, uniform, categorical } = require('./random');
const binarySearch = require('./binary_search');
const i18n = require('./i18n');
const { makeDummyEntity } = require('./utils');

function isGoodWord(word) {
    // filter out words that cannot be in the dataset,
    // because they would be either tokenized/preprocessed out or
    // they are unlikely to be used with voice
    return /^([a-zA-Z0-9-][a-zA-Z0-9.-]*|'s|,|\?)$/.test(word);
}
function isGoodSentence(sentence) {
    return !/^(the|a|has|for|title|when|me|i|so|--)$/.test(sentence);
}

function isReplaceToken(tok) {
    return /^(?:GENERIC_ENTITY_|LOCATION_|QUOTED_STRING_|HASHTAG_|USERNAME_)/.test(tok);
}

const NON_REPLACEABLE_ENTITIES = ['tt:url', 'tt:phone_number', 'tt:email_address',
    'tt:function', 'tt:picture', 'tt:flow_token', 'tt:path_name'];
function isReplaceType(type) {
    return type.isLocation || type.isString ||
        (type.isEntity && NON_REPLACEABLE_ENTITIES.indexOf(type.type) < 0);
}

function unescape(symbol) {
    return symbol.replace(/_([0-9a-fA-Z]{2}|_)/g, (match, ch) => {
        if (ch === '_') return ch;
        return String.fromCharCode(parseInt(ch, 16));
    });
}

function constantToNN(constant) {
    let measure = /__const_NUMBER_([0-9]+)__([a-z0-9A-Z]+)/.exec(constant);
    if (measure !== null)
        return 'NUMBER_' + measure[1];

    return unescape(constant.substring('__const_'.length));
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
        this._debug = _default(options.debug, true);
        
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

    async _getParamListKey(schema, pname, ptype) {
        if (schema === null && (pname === 'source' || pname === 'executor'))
            return ['string', 'tt:person_first_name'];
        while (ptype.isArray)
            ptype = ptype.elem;

        if (!ptype.isEntity && !ptype.isString && !ptype.isLocation)
            throw new TypeError(`Unexpected replaced type ${ptype}`);

        const arg = schema.getArgument(pname);
        // if we get here, the program was typechecked, so we know we have this argument
        assert(arg);

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

    async _sampleParam([schema, pname, ptype, pop]) {
        let valueListKey = await this._getParamListKey(schema, pname, ptype);
        const fallbackKey = this._getFallbackParamListKey(pname, ptype);
        if (valueListKey[0] === 'string' && valueListKey[1] !== fallbackKey &&
            coin(this._untypedStringProbability, this._rng))
            valueListKey = ['string', fallbackKey];

        let valueList = await this._loader.get(valueListKey);
        if (valueList.size === 0) {
            if (this._debug) {
                if (!this._warned.has(pname + ':' + ptype)) {
                    console.error(`Found no values for ${pname}:${ptype}`);
                    this._warned.add(pname + ':' + ptype);
                }
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
                assert(!token.startsWith('SLOT_'));
                output.push(token);
            }
        }
        return output;
    }

    _replaceWithSlot(code, entities) {
        let counter = 0;
        const out = [];
        for (let i = 0; i < code.length; i++) {
            const token = code[i];
            if (isReplaceToken(token)) {
                const slot = `SLOT_${counter++}`;

                const [,entityType, number] = /^(.*)_([0-9]+)$/.exec(token);
                let escaped = entityType.replace(/[:._]/g, (match) => {
                    if (match === '_')
                        return '__';
                    let code = match.charCodeAt(0);
                    return code < 16 ? '_0' + code.toString(16) : '_' + code.toString(16);
                });
                escaped += '_' + number;
                if (i < code.length - 1 && code[i+1].startsWith('unit:')) {
                    escaped = escaped + '__' + code[i+1].substring('unit:'.length);
                    i++;
                }

                const varref = new Ast.Value.VarRef(`__const_${escaped}`);
                varref.token = token;
                entities[slot] = varref;
                out.push(slot);
            } else if (/^[A-Z]/.test(token)) {
                entities[token] = makeDummyEntity(token);
                out.push(token);
            } else {
                out.push(token);
            }
        }

        return out;
    }

    async _computeReplaceableParameters(context, code) {
        const parameters = new Map;
        const contextEntities = new Set;
        for (let token of context) {
            if (isReplaceToken(token))
                contextEntities.add(token);
        }

        let entities = {};
        // replace all entities with SLOT_*, which allows us to pass a VarRef instead of a real value
        const replaced = this._replaceWithSlot(code, entities);

        const program = ThingTalk.NNSyntax.fromNN(replaced, entities);
        await program.typecheck(this._schemas, true);

        function isEntity(value) {
            if (value.isVarRef && value.name.startsWith(`__const_`)) {
                if (!value.token)
                    value.token = constantToNN(value.name);
                return true;
            } else {
                return false;
            }
        }

        if (program.isProgram && program.executor && isEntity(program.executor))
            parameters.set(program.token, [null, 'executor', Type.Entity('tt:contact'), '=']);

        for (let [schema, slot] of program.iterateSlots()) {
            if (slot instanceof Ast.Selector)
                continue;
            if (isEntity(slot.value)) {
                let argname = slot.name;

                if (schema === null) {
                    if (program.isPermissionRule) {
                        assert(slot.name === 'source');
                        parameters.set(slot.value.token, [null, 'source', Type.Entity('tt:contact'), '=']);
                    } else {
                        // else ignore this parameter, it probably comes from a
                        // bookkeeping answer QUOTED_STRING_0 which we don't need to worry about
                        // because it would be never generated anyway
                        assert(program.isBookkeeping);
                    }
                } else {
                    let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
                    if (slot instanceof Ast.BooleanExpression && slot.operator === 'contains')
                        type = type.elem;

                    if (isReplaceType(type)) {
                        assert(isReplaceToken(slot.value.token));

                        if (type.isLocation && !this._replaceLocations)
                            continue;

                        let operator = '=';
                        if (slot instanceof Ast.BooleanExpression)
                            operator = slot.operator;

                        parameters.set(slot.value.token, [schema, argname, type, operator]);
                    }
                }
            }
        }

        for (let token of parameters.keys()) {
            if (contextEntities.has(token)) {
                parameters.delete(token);
                continue;
            }

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
                    parameters.delete(token);
            }
        }

        return parameters;
    }

    async process(example) {
        const sentence = example.preprocessed.split(' ');
        const program = example.target_code.split(' ');

        let parameters;
        try {
            parameters = await this._computeReplaceableParameters(example.context ? example.context.split(' '): [], program);
        } catch(e) {
            console.error(example);
            throw e;
        }

        const promises = [];
        for (let i = 0; i < this._blowupFactor(example, parameters); i++) {
            promises.push((async () => {
                const replacements = new Map();
                try {
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
                } catch(e) {
                    console.error(example);
                    throw e;
                }
            })());
        }
        return Promise.all(promises);
    }
};
