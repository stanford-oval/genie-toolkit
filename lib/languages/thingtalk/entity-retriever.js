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
"use strict";

const ThingTalk = require('thingtalk');
const NNSyntax = ThingTalk.NNSyntax;

const I18n = require('../../i18n');

module.exports = class GenieEntityRetriever extends NNSyntax.EntityRetriever {
    constructor(sentence, entities, options) {
        super(sentence, entities);

        this._locale = options.locale;
        this._langPack = I18n.get(this._locale);
        this._tokenizer = this._langPack.getTokenizer();
        this._allowNonConsecutive = options.allowNonConsecutive;
        this._useHeuristics = options.useHeuristics;
        this._alwaysAllowStrings = options.alwaysAllowStrings;
    }

    _sentenceContainsNonConsecutive(tokens) {
        // check that the sequence "sentence" contains the subsequence "tokens"
        // other tokens can be interspersed between the tokens of "tokens"
        // but the order cannot be changed
        //
        // this uses a greedy algorithm
        // the recurrence is:
        //  - for a suffix of sentence starting at index i
        //    - for a suffix of tokens starting at index j
        //      - if sentence[i] == tokens[j]
        //         - return recurse(i+1, j+1)
        //      - else
        //         - return recurse(i+1, j)

        const sentence = this.sentence;
        function recursiveHelper(i, j) {
            if (j === tokens.length) // no tokens left to match (all tokens matched)
                return true;
            if (i === sentence.length) // empty sentence suffix
                return false;

            if (sentence[i] === tokens[j])
                return recursiveHelper(i+1, j+1);
            else
                return recursiveHelper(i+1, j);
        }

        return recursiveHelper(0, 0);
    }

    _findEntityFromSentence(entityType, entityString, ignoreNotFound) {
        // use the raw tokens, rather than the preprocessed tokens
        // the difference is NUMBER/TIME/etc are shown in numeric form
        // if those tokens are present in the entity name we have a bug
        // (they should not be in the parameter datasets) but if we expose
        // the neural network to out of order entities we'll have a
        // bigger problem
        // those tokens won't be found in the sentence anyway, so this matters
        // only if `alwaysAllowStrings` is set
        let entityTokens = this._tokenizer.tokenize(entityString).rawTokens;

        let found = this._allowNonConsecutive ?
            this._sentenceContainsNonConsecutive(entityTokens) :
            this._sentenceContains(entityTokens);
        if (found)
            return entityTokens.join(' ');

        if (this._useHeuristics) {
            if (entityType === 'LOCATION') {
                // HACK to support paraphrasing
                // we're changing the location name here, slightly
                if (entityString.indexOf(',') >= 0) {
                    const entityNoComma = this._tokenizer.tokenize(entityString.replace(/,/g, '').rawTokens);
                    if (this._sentenceContains(entityNoComma))
                        return entityNoComma.join(' ');
                }

                if (entityString === 'los angeles , california' && this._sentenceContains(['los', 'angeles']))
                    return 'los angeles';
                if (entityString === 'palo alto , california' && this._sentenceContains(['palo', 'alto']))
                    return 'palo alto';
            }

            // "pluralize" the entity and try again
            const entityPlural = this._langPack.pluralize(entityTokens.join(' '));

            // note: if we find the plural form, we'll still predict the singular form!
            // this is used for certain cases of MultiWOZ where we need to predict normalized
            // strings or we fail to find results in database
            if (entityPlural && this._sentenceContains(entityPlural.split(' ')))
                return entityTokens.join(' ');
        }

        // if we get here, we have not found the entity...

        // to accommodate certain MultiWOZ misannotations, we allow the neural network
        // to hallucinate entities entirely
        if (!ignoreNotFound && this._alwaysAllowStrings && entityType === 'QUOTED_STRING')
            return entityTokens.join(' ');

        return undefined;
    }
};
