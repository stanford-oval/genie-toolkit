// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import assert from 'assert';
import { Type } from 'thingtalk';

import { categorical } from './random';
import * as I18n from '../i18n';

import {
    makeDummyEntity,
    makeDummyEntities,
    renumberEntities,
} from './entity-utils';

class ValidationError extends Error {
    code : string;

    constructor(message : string) {
        super(message);
        this.code = 'EINVAL';
    }
}

function clean(name : string) : string {
    if (/^[vwgp]_/.test(name))
        name = name.substr(2);
    return name.replace(/_/g, ' ').trim().replace(/([^A-Z ])([A-Z])/g, '$1 $2').toLowerCase();
}

export function cleanKind(kind : string) : string {
    // thingengine.phone -> phone
    if (kind.startsWith('org.thingpedia.builtin.thingengine.'))
        kind = kind.substr('org.thingpedia.builtin.thingengine.'.length);
    // org.thingpedia.builtin.omlet -> omlet
    if (kind.startsWith('org.thingpedia.builtin.'))
        kind = kind.substr('org.thingpedia.builtin.'.length);
    // org.thingpedia.iot.switch -> switch
    if (kind.startsWith('org.thingpedia.iot.'))
        kind = kind.substr('org.thingpedia.iot.'.length);
    // org.thingpedia.weather -> weather
    if (kind.startsWith('org.thingpedia.'))
        kind = kind.substr('org.thingpedia.'.length);
    // com.xkcd -> xkcd
    if (kind.startsWith('com.'))
        kind = kind.substr('com.'.length);
    if (kind.startsWith('gov.'))
        kind = kind.substr('gov.'.length);
    if (kind.startsWith('org.'))
        kind = kind.substr('org.'.length);
    if (kind.startsWith('uk.co.'))
        kind = kind.substr('uk.co.'.length);
    kind = kind.replace(/[.-]/g, ' ');
    return clean(kind);
}

const PARAM_REGEX = /\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})/;

function* split(pattern : string, regexp : RegExp|string) : Generator<string|string[], void> {
    // a split that preserves capturing parenthesis

    const clone = new RegExp(regexp, 'g');
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



function splitParams(utterance : string) : Array<string|string[]> {
    return Array.from(split(utterance, PARAM_REGEX));
}

function tokenizeExample(tokenizer : I18n.BaseTokenizer,
                         utterance : string,
                         id : number) : string {
    let replaced = '';
    const params : Array<[string, string]> = [];

    for (const chunk of splitParams(utterance.trim())) {
        if (chunk === '')
            continue;
        if (typeof chunk === 'string') {
            replaced += chunk;
            continue;
        }

        const [match, param1, param2, opt] = chunk;
        if (match === '$$') {
            replaced += '$';
            continue;
        }
        const param = param1 || param2;
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
            const [param, opt] = params.shift()!;
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

function sampleString(words : string[], langPack : I18n.LanguagePack, rng : () => number) : string|null {
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

function isHumanEntity(type : Type|string) : boolean {
    if (type instanceof Type.Entity)
        return isHumanEntity(type.type);
    if (type instanceof Type.Array)
        return isHumanEntity(type.elem);
    if (typeof type !== 'string')
        return false;
    if (['tt:contact', 'tt:username', 'org.wikidata:human'].includes(type))
        return true;
    if (type.startsWith('org.schema') && type.endsWith(':Person'))
        return true;
    return false;
}

export {
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
