// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import { Ast, Type } from 'thingtalk';
import { 
    PARTS_OF_SPEECH, 
    PROJECTION_PARTS_OF_SPEECH, 
    CanonicalAnnotation 
} from './base-canonical-generator';

export interface ParaphraseExample {
    query : string,
    queryCanonical : string,
    argument : string, 
    utterance : string,
    value ?: string|boolean,
    paraphrases : string[]
}

function isHumanType(type : Type) {
    if (type instanceof Type.Entity) {
        if (type.type === 'human')
            return true;
    }
    return false;
}

function generateExamplesByPOS(query : Ast.FunctionDef,
                               queryCanonical : string,
                               argument : Ast.ArgumentDef,
                               argumentCanonical : string,
                               pos : string, 
                               value ?: string|boolean) : ParaphraseExample[] {
    function example(utterance : string) : ParaphraseExample {
        return { query: query.name, queryCanonical, argument: argument.name, utterance, value, paraphrases : [] };
    }
    const interrogativePronoun = isHumanType(argument.type) ? 'who' : `which ${queryCanonical}`;
    if (!PROJECTION_PARTS_OF_SPEECH.includes(pos)) {
        if (!argumentCanonical.includes('#'))
            argumentCanonical = argumentCanonical + ' #';
    }
    const predicate = typeof value === 'string' ? argumentCanonical.replace('#', value) : argumentCanonical;
    switch (pos) {
    case 'base':
        return [
            example(`What is the ${argumentCanonical} of the ${queryCanonical}?`),
            example(`What is the ${queryCanonical} 's ${argumentCanonical}?`),
            example(`What ${argumentCanonical} does the ${queryCanonical} have?`)
        ];
    case 'property':
    case 'property_true':
    case 'property_false':
        return [
            example(`Show me a ${queryCanonical} with ${predicate}.`),
            example(`${interrogativePronoun} has ${predicate}?`)
        ];
    case 'verb':
    case 'verb_true':
    case 'verb_false':
        return [
            example(`Show me a ${queryCanonical} that ${predicate}.`),
            example(`${interrogativePronoun} ${predicate}?`)
        ];
    case 'passive_verb':
    case 'passive_verb_true':
    case 'passive_verb_false':
    case 'preposition':
    case 'preposition_true':
    case 'preposition_false':
        return [
            example(`Show me a ${queryCanonical} ${predicate}.`),
            example(`${interrogativePronoun} is ${predicate}?`)
        ];
    case 'reverse_property':
    case 'reverse_property_true':
    case 'reverse_property_false':
        return [
            example(`${interrogativePronoun} is a ${predicate}?`)
        ];
    case 'adjective':
    case 'adjective_true':
    case 'adjective_false':
        return [
            example(`Show me a ${predicate} ${queryCanonical}.`),
            example(`${interrogativePronoun} is ${predicate}?`)
        ];
    case 'reverse_verb':
        return [
            example(`${interrogativePronoun} ${predicate} the ${queryCanonical}?`)
        ];
    default:
        return [];
    }
    
}

export function generateExamples(query : Ast.FunctionDef,
                                 arg : Ast.ArgumentDef, 
                                 baseCanonicalAnnotation : CanonicalAnnotation, 
                                 sampleValues : string[]) : ParaphraseExample[] {
    const examples : ParaphraseExample[] = [];
    const queryCanonical = Array.isArray(query.nl_annotations.canonical) ? query.nl_annotations.canonical[0] : query.nl_annotations.canonical;
    for (const [pos, canonicals] of Object.entries(baseCanonicalAnnotation)) {
        if (!PARTS_OF_SPEECH.includes(pos)) 
            continue;
        for (const canonical of canonicals) {
            if (PROJECTION_PARTS_OF_SPEECH.includes(pos)) {
                examples.push(...generateExamplesByPOS(query, queryCanonical, arg, canonical, pos));
            } else {
                for (const value of sampleValues) 
                    examples.push(...generateExamplesByPOS(query, queryCanonical, arg, canonical, pos, value));
            }
        }    
    }
    return examples;
}