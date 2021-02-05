// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2021 The Board of Trustees of the Leland Stanford Junior University
//           2019 National Taiwan University
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

import * as I18n from '../../i18n';

// FIXME remove duplication with code in templates

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

export function splitParams(utterance : string) : Array<string|string[]> {
    return Array.from(split(utterance, PARAM_REGEX));
}

export function tokenizeExample(tokenizer : I18n.BaseTokenizer,
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
        throw new Error(`Error in Example ${id}: Cannot have entities in the utterance`);

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
