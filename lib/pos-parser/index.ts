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
// Author: Silei Xu <silei@cs.stanford.edu>

import { specialTokens, NFA, toNFA } from './nfa';

// maximum length of the canonical (value excluded)
const MAX_LENGTH = 5;

const a = '( a | an | any | some | all | the | ε )';
const that = '( that | which | who | ε )';
const is = '( is | are | was | were )';
const does = '( does | do | did )';
const has = '( has | have | had )';
const find = '( show me | find me | tell me | give me | find | search | get | search for | i want | i need | i would like )';
const who = '( what $domain | which $domain | who | where )';
const noun = '( NN | NNS | NNP | NNPS )';
const verb = '( VBP | VBD | VBZ )';
const passiveVerb = '( VBN | VBG | JJ )';
const preposition = '( IN | TO )';

const queryTemplates : Record<string, string[]> = {
    'property': [
        `${find} ${a} $domain with [ .* $value .* ${noun} ]`,
        `${find} ${a} $domain ${that} ${has} [ .* $value .* ${noun} ]`,
        `${who} ${has} [ .* $value .* ]`
    ],
    'passive_verb': [
        `${find} ${a} $domain [ ${passiveVerb} .* $value .* ]`,
        `${find} ${a} $domain ${that} ${is} [ ${passiveVerb} .* $value .* ]`,
        `${who} ${is} [ ${passiveVerb} .* $value .* ]`,
        `who's [ ${passiveVerb} .* $value .* ]`
    ],
    'preposition': [
        `${find} ${a} $domain [ ${preposition} .* $value .* ]`,
        `${find} ${a} $domain ${that} ${is} [ ${preposition} .* $value .* ]`,
        `${who} ${is} [ ${preposition} .* $value .* ]`,
        `who's [ ${preposition} .* $value .* ]`
    ],
    'verb': [
        `${who} ${does} [ $value .* ]`, // some verbs are tagged as noun, so no ${verb} requirement after $value
        `${find} ${a} $domain ${that} [ ${verb} .* $value .* ]`,
        `${who} [ ${verb} .* $value .* ]`,
    ],
    'reverse_property' : [
        `${find} ${a} [ .* ${noun} ]`,
        `${who} ${is} [ .* ${noun} ]`,
        `who's [ .* ${noun} ]`
    ],
    'adjective' : [
        `${find} ${a} [ .* $value .* ] $domain`,
        `${who} ${is} [ .* $value .* ]`
    ],
};

interface Annotation {
    pos : string,
    canonical : string
}

// tokenize template string (basically add spaces around special characters)
function tokenize(template : string) {
    const chars : string[] = [];
    let lastChar = ' ';
    for (const char of template) {
        if (char === ' ' && lastChar === ' ')
            continue;

        if (specialTokens.includes(char) && lastChar !== ' ')
            chars.push(' ');
        else if (specialTokens.includes(lastChar) && char !== ' ')
            chars.push(' ');

        chars.push(char);
        lastChar = char;
    }
    return chars.join('').split(' ');
}

export default class PosParser {
    private readonly queryTemplates : Record<string, NFA[]>;

    constructor() {
        this.queryTemplates = {};
        for (const pos in queryTemplates) {
            this.queryTemplates[pos] = [];
            for (const template of queryTemplates[pos])
                this.queryTemplates[pos].push(toNFA(tokenize(template)));
        }
    }

    match(type : 'query'|'action', utterance : string, domainCanonicals : string[], value : string) : Annotation[] {
        if (type === 'query') {
            for (const pos in this.queryTemplates) {
                for (const template of this.queryTemplates[pos]) {
                    const match = template.match(utterance, domainCanonicals, value);
                    if (match && match.split(' ').length - 1 < MAX_LENGTH) {
                        if (pos === 'verb' && match.startsWith('$value ')) {
                            return [
                                { pos, canonical: match },
                                { pos: 'reverse_verb_projection', canonical: match.replace('$value ', '') }
                            ];
                        }
                        return [{ pos, canonical: match }];
                    }
                }
            }
        }
        return [];
    }
}

