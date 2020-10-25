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


import assert from 'assert';
import * as Tp from 'thingpedia';

import { Ast, SchemaRetriever, Grammar, NNSyntax } from 'thingtalk';
import GenieEntityRetriever from './entity-retriever';
import type { EntityMap } from '../../utils/entity-utils';

interface ParseOptions {
    thingpediaClient : Tp.BaseClient;
    schemaRetriever ?: SchemaRetriever;
}

export async function parse(code : string, options : ParseOptions) : Promise<Ast.Input> {
    const tpClient = options.thingpediaClient;
    if (!options.schemaRetriever)
        options.schemaRetriever = new SchemaRetriever(tpClient, null, true);

    assert(code);
    const state = await Grammar.parseAndTypecheck(code, options.schemaRetriever, false);
    return state;
}

export async function parsePrediction(code : string|string[], entities : EntityMap, options : ParseOptions) : Promise<Ast.Input|null> {
    const tpClient = options.thingpediaClient;
    if (!options.schemaRetriever)
        options.schemaRetriever = new SchemaRetriever(tpClient, null, true);

    const schemas = options.schemaRetriever;
    try {
        if (typeof code === 'string')
            code = code.split(' ');
        const state = NNSyntax.fromNN(code, entities).optimize();
        if (!state)
            return null;
        await state.typecheck(schemas, true);

        // convert the program to NN syntax once, which will force the program to be syntactically normalized
        // (and therefore rearrange slot-fill by name rather than Thingpedia order)
        NNSyntax.toNN(state, [], {}, { allocateEntities: true });
        return state;
    } catch(e) {
        return null;
    }
}

interface SerializeOptions {
    allocateEntities ?: boolean;
    typeAnnotations ?: boolean;
    locale ?: string;
    ignoreSentence ?: boolean;
}

export function serializeNormalized(program : Ast.Input, entities : EntityMap = {}, options : SerializeOptions = {}) : [string[], EntityMap] {
    options.allocateEntities = true;
    options.typeAnnotations = false;
    const code : string[] = NNSyntax.toNN(program, [], entities, options);
    return [code, entities];
}

export function serialize(ast : Ast.Input, sentence : string[], entities : EntityMap) : string[] {
    const clone = {};
    Object.assign(clone, entities);

    const sequence : string[] = NNSyntax.toNN(ast, sentence, clone);
    //ThingTalk.NNSyntax.fromNN(sequence, {});

    if (sequence.some((t) => t.endsWith(':undefined')))
        throw new TypeError(`Generated undefined type`);

    return sequence;
}

/**
 * Convert the prediction to a sequence of tokens to predict.
 *
 * This is same as {@link serialize} but we apply certain dialogue-specific heuristics.
 */
export function serializePrediction(prediction : Ast.Input,
                                    sentence : string[],
                                    entities : EntityMap,
                                    forTarget : 'user'|'agent',
                                    options : SerializeOptions) : string[] {
    if (forTarget === 'user') {
        const entityRetriever = new GenieEntityRetriever(sentence, entities, {
            locale: options.locale!,
            allowNonConsecutive: true,
            useHeuristics: true,
            alwaysAllowStrings: true,
            ignoreSentence: options.ignoreSentence || false,
        });
        return NNSyntax.toNN(prediction, sentence, entityRetriever, {
            typeAnnotations: false
        });
    } else {
        return NNSyntax.toNN(prediction, sentence, entities, {
            allocateEntities: true,
            typeAnnotations: false
        });
    }
}
