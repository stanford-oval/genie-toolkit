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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import { Ast, } from 'thingtalk';

import type AbstractDialogueAgent from '../abstract_dialogue_agent';
import ValueCategory from '../value-category';

// scoring heuristics:
// prefer full matches, allow prefix matches
// slighty prefer primary values for a contact, ignore everything else
const SCORING_MODEL = {
    exactMatch: 10,
    match: 10,
    startsWith: 3,
    substring: 2,

    isPrimary: 1,

    timesContacted: 0.0005
};

function dotProduct(a : Record<string, number>, b : Record<string, number>) : number {
    let score = 0;
    for (const name in b)
        score += (a[name] || 0) * (b[name] || 0);
    return score;
}

function expNormalize(scores : number[]) : number[] {
    const prob : number[] = [];
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < scores.length; i++)
        max = Math.max(max, scores[i]);
    if (max === Infinity || max === -Infinity)
        throw new RangeError();
    for (let i = 0; i < scores.length; i++) {
        prob[i] = Math.exp(scores[i] - max);
        sum += prob[i];
    }
    for (let i = 0; i < scores.length; i++)
        prob[i] /= sum;
    return prob;
}

interface ScoredExample<T> {
    ex : T;
    score : number;
    prob : number;
}

class SimpleClassifier<T> {
    private extractor : (ex : T) => Record<string, number>;
    private params : Record<string, number>;

    constructor(featureExtractor : (ex : T) => Record<string, number>,
                params : Record<string, number>) {
        this.extractor = featureExtractor;
        this.params = params;
    }

    score(example : T) : number {
        return dotProduct(this.extractor(example), this.params);
    }

    scoreAll(examples : T[]) : Array<ScoredExample<T>> {
        const scores = new Array<number>(examples.length);
        examples.forEach((ex, i) => {
            scores[i] = this.score(ex);
        });
        const probs = expNormalize(scores);
        const mapped = examples.map((ex, i) => {
            return {
                ex: ex,
                score: scores[i],
                prob: probs ? probs[i] : NaN
            };
        });
        mapped.sort((a : ScoredExample<T>, b : ScoredExample<T>) => {
            return b.score - a.score;
        });
        return mapped;
    }
}

function featurizeContact(contact : string, candidate : Contact) : Record<string, number> {
    const features : Record<string, number> = {
        // search features
        exactMatch: 0,
        match: 0,
        startsWith: 0,
        substring: 0,

        // candidate features
        isPrimary: 0,
        starred: 0,
        timesContacted: 0,
        age: 0
    };
    function computeMatches(candidate : string, search : string) {
        if (candidate === search) {
            features.exactMatch++;
        } else {
            const lowerCaseCandidate = candidate.toLowerCase().trim();
            const lowerCaseSearch = search.toLowerCase().trim();

            if (lowerCaseCandidate === lowerCaseSearch)
                features.match++;
            else if (lowerCaseCandidate.startsWith(lowerCaseSearch))
                features.startsWith++;
            else if (lowerCaseCandidate.indexOf(lowerCaseSearch) >= 0)
                features.substring++;
        }
    }
    computeMatches(candidate.displayName, contact);
    if (candidate.alternativeDisplayName)
        computeMatches(candidate.alternativeDisplayName, contact);

    if (candidate.isPrimary)
        features.isPrimary ++;
    if (candidate.starred)
        features.starred = 1;
    features.timesContacted = candidate.timesContacted || 0;

    // add overfitting features for things like "mom" and "dad"
    const tokens = contact.toLowerCase().trim().split(/\s+/);
    for (const t of tokens)
        features['align --- ' + t + '=' + candidate.value] = 1;

    return features;
}


function makeValue(category : ValueCategory, choice : Contact) {
    if (category === ValueCategory.PhoneNumber)
        return new Ast.Value.Entity(choice.value, 'tt:phone_number', choice.displayName);
    else if (category === ValueCategory.EmailAddress)
        return new Ast.Value.Entity(choice.value, 'tt:email_address', choice.displayName);
    else
        return new Ast.Value.Entity(choice.value, 'tt:contact', choice.displayName);
}

export interface Contact {
    value : string;
    displayName : string;
    alternativeDisplayName ?: string;
    isPrimary ?: boolean;
    starred ?: boolean;
    timesContacted ?: number;
}

export async function contactSearch(dlg : AbstractDialogueAgent<unknown>, type : string, name : string) {
    let category;
    switch (type) {
        case 'tt:phone_number':
            category = ValueCategory.PhoneNumber as const;
            break;
        case 'tt:email_address':
            category = ValueCategory.EmailAddress as const;
            break;
        case 'tt:contact':
            category = ValueCategory.Contact as const;
            break;
        default:
            throw new TypeError('Invalid contact type ' + type);
    }

    const choices = name === null ? [] : await dlg.lookupContact(category, name);
    if (choices.length === 0) {
        const answer = await dlg.askMissingContact(category, name);
        const contact = {
            value: answer.value!,
            displayName: answer.display!
        };
        if (category === ValueCategory.Contact)
            contact.value = 'phone:' + contact.value;
        return makeValue(category, contact);
    }

    if (choices.length === 1)
        return makeValue(category, choices[0]);

    const model = new SimpleClassifier(featurizeContact.bind(null, name), SCORING_MODEL);
    const scored = model.scoreAll(choices);

    // apply the usual scoring heuristics
    const prob = scored[0].prob;
    const top = scored[0].ex;
    let choice = null;
    const fallbacks : Contact[] = [];

    if (prob > 0.9) {
        choice = top;
    } else if (prob > 0.5 && scored[0].score >= 0) {
        choice = top;
    } else {
        for (const candidate of scored) {
            if (candidate.prob < 0.15 || candidate.score < -10)
                break;
            fallbacks.push(candidate.ex);
        }
    }

    if (choice !== null)
        return makeValue(category, choice);

    const idx = await dlg.disambiguate('contact', name, fallbacks.map((c) => c.displayName));
    return makeValue(category, fallbacks[idx]);
}
