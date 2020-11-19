// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const { coin, uniform } = require('../../utils/random');
const binarySearch = require('../../utils/binary_search');
const i18n = require('../../i18n');
const { makeDummyEntity, sampleString } = require('../../utils/misc-utils');


function isReplaceToken(tok) {
    return /^(?:GENERIC_ENTITY_|LOCATION_|NUMBER_|QUOTED_STRING_|HASHTAG_|USERNAME_)/.test(tok);
}

const NON_REPLACEABLE_ENTITIES = ['tt:url', 'tt:email_address',
    'tt:function', 'tt:picture', 'tt:flow_token', 'tt:path_name'];

function isReplaceType(type) {
    return type.isLocation || type.isString || type.isNumber || type.isMeasure ||
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
    const underscoreindex = constant.lastIndexOf('_');
    const entitytype = unescape(constant.substring('__const_'.length, underscoreindex));
    return entitytype + constant.substring(underscoreindex);
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

class SequentialValueList {
    constructor(values) {
        this._values = values;
        this._index = 0;
    }

    get size() {
        return this._values.length;
    }

    sample(rng) {
        if (this._index === this._values.length)
            this._index = 0;
        const value = this._values[this._index];
        this._index += 1;
        return value;
    }
}

class ValueListLoader {
    constructor(provider, samplingType, subsetParamSet, rng) {
        this._provider = provider;

        this._emptyList = new UniformValueList([]);
        this._cache = new Map;
        this._samplingType = samplingType;
        this._subsetParamSet = subsetParamSet;
        this._rng = rng;
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
        let rows = await this._provider.get(valueListType, valueListName);

        // overwrite weights with random values
        if (this._samplingType === 'random') {
            for (let row of rows)
                row.weight = Math.round(this._rng() * 100);
        } else if (this._samplingType === 'uniform') {
            for (let row of rows)
                row.weight = 1;
        }

        const [beg, end] = this._subsetParamSet;
        let rows_size = rows.length;
        let slice_beg = beg * rows_size;
        let slice_end;
        // make sure we have at least one row
        if ((end - beg) * rows_size < 1.0)
            slice_end = slice_beg + 1;
        else
            slice_end = end * rows_size;
        rows = rows.slice(slice_beg, slice_end);

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
        if (this._samplingType === 'sequential')
            return new SequentialValueList(rows.map((r) => r.preprocessed));
        else if ((maxWeight - minWeight) / (sumWeight / rows.length) < 0.0001)
            return new UniformValueList(rows.map((r) => r.preprocessed));
        else
            return new WeightedValueList(rows.map((r) => r.preprocessed), rows.map((r) => r.weight));
    }
}

function* resampleIgnorableAndAbbreviations(langPack, ptype, sentence, rng) {
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
        this._loader = new ValueListLoader(constProvider, options.samplingType, options.subsetParamSet, options.rng);
        this._rng = _default(options.rng, Math.random);
        this._addFlag = _default(options.addFlag, false);
        this._langPack = i18n.get(options.locale);
        this._paramLangPack = i18n.get(options.paramLocale);
        this._quotedProbability = _default(options.quotedProbability, 0.1);
        this._untypedStringProbability = _default(options.untypedStringProbability, 0.01);
        this._maxSpanLength = _default(options.maxSpanLength, 10);
        this._replaceLocations = _default(options.replaceLocations, true);
        this._replaceNumbers = _default(options.replaceNumbers, false);
        this._cleanParameters = _default(options.cleanParameters, true);
        this._requotable = _default(options.requotable, true);
        this._numAttempts = _default(options.numAttempts, 10000);
        this._debug = _default(options.debug, true);

        this._blowUpSynthetic = _default(options.syntheticExpandFactor, 5);
        this._blowUpNoQuote = _default(options.noQuoteExpandFactor, 10);
        this._blowUpParaphrasing = _default(options.paraphrasingExpandFactor, 30);
        this._blowUpAugmented = Math.ceil(this._blowUpParaphrasing/2);

        this._warned = new Set;
    }

    _warn(key, message) {
        if (!this._warned.has(key)) {
            console.error(message);
            this._warned.add(key);
        }
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

    _getSlotArg(slot) {
        const prim = slot.primitive;
        if (prim === null)
            return null;

        if (slot.tag === 'attribute.name')
            return null;

        let pname;
        if (slot.tag.startsWith('in_param.'))
            pname = slot.tag.split('.')[1];
        else if (slot.tag.startsWith('filter.'))
            pname = slot.tag.split('.')[2];
        else if (slot.tag.startsWith('compute.') || slot.tag.startsWith('compute_filter.') || slot.tag === 'slice.limit') // do nothing
            ;
        else // other slots should have the right number
            throw new Error(`Unrecognized slot tag ${slot.tag}`);

        let arg = slot.arg || slot._arg;
        if (!arg && prim && prim.schema)
            arg = prim.schema.getArgument(pname);
        if (!arg) {
            this._warn('noarg:' + slot.tag + ':' + slot.type, `Found no argument property for ${slot.tag}:${slot.type}`);
            return null;
        }
        return arg;
    }

    _getParamListKey(slot, arg) {
        const prim = slot.primitive;
        if (prim === null && (
            slot.tag === 'filter.==.$source' ||
            slot.tag.startsWith('filter.in_array.$source') ||
            slot.tag === 'program.principal'))
            return ['string', 'tt:person_first_name'];

        if (!slot.type.isEntity && !slot.type.isString && !slot.type.isLocation && !slot.type.isNumber && !slot.type.isMeasure)
            throw new TypeError(`Unexpected replaced type ${slot.type}`);

        if (slot.tag === 'attribute.name')
            return ['string', prim.selector.kind + ':__name'];

        if (arg && arg.annotations.string_values && arg.annotations.string_values.value)
            return ['string', arg.annotations.string_values.toJS()];

        if (slot.type.isEntity)
            return this._getEntityListKey(slot.type.type);

        return ['string', this._getFallbackParamListKey(slot)];
    }

    _getEntityListKey(entityType) {
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
            return ['entity', entityType];
        }
    }

    _getFallbackParamListKey(slot) {
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

    _transformValue(sentenceValue, programValue, arg) {
        if (this._requotable)
            return {sentenceValue, programValue};

        if (arg && arg.metadata.pluralize && coin(0.5, this._rng)) {
            const plural = this._paramLangPack.pluralize(sentenceValue);
            if (plural)
                return { sentenceValue: plural, programValue };
        }

        let hasDefiniteArticle = false;
        if (this._paramLangPack.DEFINITE_ARTICLE_REGEXP) {
            // remove a definite article ("the") from the program value if we have it
            const match = this._paramLangPack.DEFINITE_ARTICLE_REGEXP.exec(programValue);
            if (match !== null) {
                hasDefiniteArticle = true;
                programValue = programValue.substring(match[0].length);
                if (coin(0.5, this._rng))
                    sentenceValue = sentenceValue.substring(match[0].length);
            }
        }

        // hack for hotel & linkedin/books domain: remove "hotel" in the end of names; remove "award" at the end of awards
        if (arg && arg.name === 'id' && arg.type.isEntity && arg.type.type.endsWith(':Hotel') && programValue.endsWith(' hotel')) {
            programValue = programValue.substring(0, programValue.length - ' hotel'.length);
            if (coin(0.5, this._rng))
                sentenceValue = sentenceValue.substring(0, sentenceValue.length - ' hotel'.length);
        }

        const suffixToRemove = { award: [' award', ' awards'] };
        for (let argname in suffixToRemove) {
            for (let suffix of suffixToRemove[argname]) {
                if (arg && arg.name === argname && programValue.endsWith(suffix)) {
                    programValue = programValue.substring(0, programValue.length - suffix.length);
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

    async _sampleParam(slot, replacedValuesSet) {
        const arg = this._getSlotArg(slot);
        let valueListKey = this._getParamListKey(slot, arg);
        const fallbackKey = this._getFallbackParamListKey(slot);
        if (valueListKey[0] === 'string' && valueListKey[1] !== fallbackKey &&
            coin(this._untypedStringProbability, this._rng))
            valueListKey = ['string', fallbackKey];

        let valueList = await this._loader.get(valueListKey);
        if (valueList.size === 0) {
            if (this._debug)
                this._warn('novalue:' + slot.tag + ':' + slot.type, `Found no values for ${slot.tag}:${slot.type}, falling back to ${fallbackKey}`);

            valueList = await this._loader.get(['string', fallbackKey]);
            if (valueList.size === 0)
                throw new Error(`Fallback value list is empty: missing required parameter list ${fallbackKey} for ${slot.tag}:${slot.type}`);
        }

        let operator;
        if (slot.tag.startsWith('filter.'))
            operator = slot.tag.split('.')[1];
        else
            operator = '==';
        if (operator === '=~') {
            let arg = slot.arg || slot._arg;
            if (arg && arg.type.isEntity)
                operator = '==';
        }

        let attempts = this._numAttempts;
        while (attempts > 0) {
            const sampled = valueList.sample(this._rng).toLowerCase();
            let words = sampled.split(' ');
            words = Array.from(resampleIgnorableAndAbbreviations(this._paramLangPack, slot.type, words, this._rng));

            if (this._cleanParameters &&
                (/[,?!.'\-_]/.test(sampled) || ['1', '2', '3'].includes(sampled)) &&
                attempts > this._numAttempts * 0.9){
                attempts -= 1;
                continue;
            }

            // if sampled is a number and we are instructed to replace numbers, return sampled value right away
            if (this._replaceNumbers && this._paramLangPack.isGoodNumber(sampled)) {
                // avoid having duplicate numbers in the sentence because they cannot be requoted properly
                if (replacedValuesSet.has(sampled)) {
                    attempts -= 1;
                    continue;
                } else {
                    return { sentenceValue: sampled, programValue: sampled };
                }
            }

            if (operator === '=~') {
                let candidate = sampleString(words, this._paramLangPack, this._rng);
                if (!candidate) {
                    attempts -= 1;
                    continue;
                }

                return this._transformValue(candidate, candidate, arg);
            }

            if (this._paramLangPack.isGoodPersonName(sampled))
                return { sentenceValue: sampled, programValue: sampled };
            if (words.some((w) => !this._paramLangPack.isGoodWord(w)) || words.length > this._maxSpanLength) {
                attempts -= 1;
                continue;
            }
            if (!this._paramLangPack.isGoodSentence(sampled)) {
                attempts -= 1;
                continue;
            }

            if (arg && arg.metadata.pluralize && coin(0.5, this._rng)) {
                const plural = this._paramLangPack.pluralize(sampled);
                if (plural)
                    return { sentenceValue: plural, programValue: sampled };
            }

            return this._transformValue(sampled, sampled, arg);
        }
        this._warn(`failreplace:${slot.tag}:${slot.type}`, `Could not replace ${valueListKey} even after ${this._numAttempts} attempts for slot ${slot}`);
        return null;
    }

    async _replaceTokensInSentence(id, sentence, parameters, replacements) {
        let output = [];
        let replacedValuesSet = new Set(replacements.values());

        for (let token of sentence) {
            if (replacements.has(token)) {
                output.push(replacements.get(token).sentenceValue);
            } else if (isReplaceToken(token)) {
                if (!parameters.has(token)) {
                    // ignore this: we might have decided not to replace the parameter
                    output.push(token);
                    continue;
                }
                const replace = await this._sampleParam(parameters.get(token), replacedValuesSet);
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

    _replaceTokensInProgram(program, replacements) {
        let output = [];
        for (let token of program) {
            if (replacements.has(token)) {
                if (token.startsWith('LOCATION_'))
                    output.push('location:');
                if (token.startsWith('NUMBER_'))
                    output.push(replacements.get(token).programValue);
                else
                    output.push('"', replacements.get(token).programValue, '"');
                if (token.startsWith('HASHTAG_'))
                    output.push('^^tt:hashtag');
                else if (token.startsWith('USERNAME_'))
                    output.push('^^tt:username');
                else if (token.startsWith('PHONE_NUMBER_'))
                    output.push('^^tt:phone_number');
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
        let inDate = false;
        const out = [];
        for (let i = 0; i < code.length; i++) {
            const token = code[i];

            // inside `new Date`, do not replace token
            if (token === 'Date')
                inDate = true;
            if (inDate === true && token === ')')
                inDate = false;
            if (!inDate && isReplaceToken(token)) {
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
            } else if (/^[A-Za-z_]+?_[0-9]+$/.test(token)) {
                entities[token] = makeDummyEntity(token);
                out.push(token);
            } else {
                out.push(token);
            }
        }

        return out;
    }

    async _computeReplaceableParameters(context, sentence, code) {
        const parameters = new Map;
        const contextEntities = new Set;
        for (let token of context) {
            if (isReplaceToken(token))
                contextEntities.add(token);
        }

        const sentenceEntities = new Set;
        for (let token of sentence) {
            if (isReplaceToken(token))
                sentenceEntities.add(token);
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

        for (let slot of program.iterateSlots2()) {
            if (slot instanceof Ast.Selector)
                continue;

            const value = slot.get();
            if (isEntity(value)) {
                if (slot.type.isAny) {
                    // ignore this parameter, it probably comes from a
                    // bookkeeping answer QUOTED_STRING_0 which we don't need to worry about
                    // because it would be never generated anyway
                    assert(program.isBookkeeping);
                }
                if (slot.type.isLocation && !this._replaceLocations)
                    continue;
                if ((slot.type.isNumber || slot.type.isMeasure) && !this._replaceNumbers)
                    continue;

                if (isReplaceType(slot.type)) {
                    assert(isReplaceToken(value.token));
                    parameters.set(value.token, slot);
                }
            }
        }

        for (let token of parameters.keys()) {
            // parameters that are present:
            // - both in the context and in the sentence: replaced so we understand whatever the user says, regardless of what's the real entity is
            // - only in the context: not replaced (copied over from context)
            // - only in the sentence: replaced (new entity, easy case)
            // - neither: warning (bug) + not replaced
            if (contextEntities.has(token) && !sentenceEntities.has(token)) {
                parameters.delete(token);
                continue;
            }

            if (/^(QUOTED_STRING|HASHTAG|USERNAME)_/.test(token)) {
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

    async process(example) {
        const sentence = example.preprocessed.split(' ');
        const programs = [];
        if (!Array.isArray(example.target_code))
            example.target_code = [example.target_code];
        for (const target_code of example.target_code)
            programs.push(target_code.split(' '));

        let parameters;
        try {
            parameters = await this._computeReplaceableParameters(example.context ? example.context.split(' '): [], sentence, programs[0]);
        } catch(e) {
            console.error(example);
            console.error(e);
            throw e;
        }

        const promises = [];
        for (let i = 0; i < this._blowupFactor(example, parameters); i++) {
            promises.push((async () => {
                const replacements = new Map();
                try {
                    const new_sentence = (await this._replaceTokensInSentence(example.id, sentence, parameters, replacements)).join(' ');
                    const new_programs = [];
                    for (const program of programs)
                        new_programs.push(await this._replaceTokensInProgram(program, replacements).join(' '));
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
                        target_code: new_programs,
                        replacements: replacements
                    };
                } catch(e) {
                    console.error(example);
                    console.error(e);
                    throw e;
                    // return {
                    //     id: example.id,
                    //     type: example.type,
                    //     flags: example.flags || {},
                    //     context: example.context,
                    //     utterance: example.utterance,
                    //     preprocessed: example.preprocessed,
                    //     target_code: example.target_code
                    // };

                }
            })());
        }
        return Promise.all(promises);
    }
};
