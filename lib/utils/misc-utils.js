// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 National Taiwan University
//           2020 The Board of Trustees of the Leland Stanford Junior University
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
//         Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>
"use strict";

const assert = require('assert');
const { categorical } = require('./random');

const {
    makeDummyEntity,
    makeDummyEntities,
    renumberEntities,
} = require('./entity-utils');

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.code = 'EINVAL';
    }
}

function clean(name) {
    if (/^[vwgp]_/.test(name))
        name = name.substr(2);
    return name.replace(/_/g, ' ').replace(/([^A-Z ])([A-Z])/g, '$1 $2').toLowerCase();
}

const PARAM_REGEX = /\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})/;

function* split(pattern, regexp) {
    // a split that preserves capturing parenthesis

    let clone = new RegExp(regexp, 'g');
    let match = clone.exec(pattern);

    let i = 0;
    while (match !== null) {
        if (match.index > i)
            yield pattern.substring(i, match.index);
        yield match;
        i = clone.lastIndex;
        match = clone.exec(pattern);
    }
    if (i < pattern.length)
        yield pattern.substring(i, pattern.length);
}



function splitParams(utterance) {
    return Array.from(split(utterance, PARAM_REGEX));
}

function tokenizeExample(tokenizer, utterance, id, language) {
    let replaced = '';
    let params = [];

    for (let chunk of splitParams(utterance.trim())) {
        if (chunk === '')
            continue;
        if (typeof chunk === 'string') {
            replaced += chunk;
            continue;
        }

        let [match, param1, param2, opt] = chunk;
        if (match === '$$') {
            replaced += '$';
            continue;
        }
        let param = param1 || param2;
        replaced += ' ____ ';
        params.push([param, opt]);
    }

    const tokenized = tokenizer.tokenize(replaced);
    const tokens = tokenized.tokens;
    const entities = tokenized.entities;

    if (Object.keys(entities).length > 0)
        throw new ValidationError(`Error in Example ${id}: Cannot have entities in the utterance`);

    let preprocessed = '';
    let first = true;
    for (let token of tokens) {
        if (token === '____') {
            let [param, opt] = params.shift();
            if (opt)
                token = '${' + param + ':' + opt + '}';
            else
                token = '${' + param + '}';
        } else if (token === '$') {
            token = '$$';
        }
        if (!first)
            preprocessed += ' ';
        preprocessed += token;
        first = false;
    }

    return preprocessed;
}

function sampleString(words, langPack, rng) {
    assert(rng);
    let seq;
    if (words.length > 6) {
        const sampledLengthIdx = categorical([0.4, 0.4, 0.2, 0.1, 0.05], rng);
        const length = [2,3,4,5,6][sampledLengthIdx];
        const idx = Math.floor(rng() * (words.length-length));

        seq = words.slice(idx, idx+length);
    } else if (words.length > 4) {
        const sampledLengthIdx = categorical([0.4, 0.4, 0.2], rng);
        const length = [2,3,4][sampledLengthIdx];
        const idx = Math.floor(rng() * (words.length-length));

        seq = words.slice(idx, idx+length);
    } else if (words.length > 2) {
        const sampledLengthIdx = categorical([0.5, 0.5], rng);
        const length = [2,3][sampledLengthIdx];
        const idx = Math.floor(rng() * (words.length-length));

        seq = words.slice(idx, idx+length);
    } else {
        seq = words;
    }
    if (seq.some((w) => !langPack.isGoodWord(w)))
        return null;
    const cand = seq.join(' ');
    if (!langPack.isGoodSentence(cand))
        return null;
    return cand;
}

function isHumanEntity(type) {
    if (type.isEntity)
        return isHumanEntity(type.type);
    if (type.isArray)
        return isHumanEntity(type.elem);
    if (typeof type !== 'string')
        return false;
    if (['tt:contact', 'tt:username', 'org.wikidata:human'].includes(type))
        return true;
    if (type.startsWith('org.schema') && type.endsWith(':Person'))
        return true;
    return false;
}

module.exports = {
    splitParams,
    split,
    clean,
    tokenizeExample,
    sampleString,

    isHumanEntity,

    makeDummyEntity,
    makeDummyEntities,
    renumberEntities,
};
