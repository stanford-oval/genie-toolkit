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

import { Ast, SchemaRetriever, Syntax } from 'thingtalk';
import GenieEntityRetriever from './entity-retriever';

export interface ParseOptions {
    locale ?: string;
    timezone : string|undefined;
    thingpediaClient : Tp.BaseClient|null;
    schemaRetriever ?: SchemaRetriever;
    loadMetadata ?: boolean;
}

export async function parse(code : string, schemas : SchemaRetriever) : Promise<Ast.Input>;
export async function parse(code : string, options : ParseOptions) : Promise<Ast.Input>;
export async function parse(code : string, options : SchemaRetriever|ParseOptions) : Promise<Ast.Input> {
    let schemas : SchemaRetriever;
    let loadMetadata : boolean;
    let parseOptions : Syntax.ParseOptions;
    if (options instanceof SchemaRetriever) {
        schemas = options;
        loadMetadata = false;
        parseOptions = { timezone: undefined };
    } else {
        const tpClient = options.thingpediaClient!;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, true);
        schemas = options.schemaRetriever;
        loadMetadata = options.loadMetadata||false;
        parseOptions = options;
    }

    assert(code);
    let parsed : Ast.Input;
    try {
        // first try parsing using normal syntax
        parsed = Syntax.parse(code, Syntax.SyntaxType.Normal, parseOptions);
    } catch(e1) {
        // if that fails, try with legacy syntax
        if (e1.name !== 'SyntaxError')
            throw e1;
        try {
            parsed = Syntax.parse(code, Syntax.SyntaxType.Legacy, parseOptions);
        } catch(e2) {
            if (e2.name !== 'SyntaxError')
                throw e2;
            throw e1; // use the first error not the second in case both fail
        }
    }
    return parsed.typecheck(schemas, loadMetadata);
}

export function parsePrediction(code : string|string[], entities : Syntax.EntityMap|Syntax.EntityResolver, options : ParseOptions, strict : true) : Promise<Ast.Input>;
export function parsePrediction(code : string|string[], entities : Syntax.EntityMap|Syntax.EntityResolver, options : ParseOptions, strict ?: boolean) : Promise<Ast.Input|null>;
export async function parsePrediction(code : string|string[], entities : Syntax.EntityMap|Syntax.EntityResolver, options : ParseOptions, strict = false) : Promise<Ast.Input|null> {
    const tpClient = options.thingpediaClient!;
    if (!options.schemaRetriever)
        options.schemaRetriever = new SchemaRetriever(tpClient, null, true);

    const schemas = options.schemaRetriever;
    try {
        let parsed : Ast.Input;
        try {
            // first try parsing using normal tokenized syntax
            parsed = Syntax.parse(code, Syntax.SyntaxType.Tokenized, entities, options);
        } catch(e1) {
            // if that fails, try with legacy NN syntax
            if (e1.name !== 'SyntaxError')
                throw e1;
            try {
                parsed = Syntax.parse(code, Syntax.SyntaxType.LegacyNN, entities, options);
            } catch(e2) {
                if (e2.name !== 'SyntaxError')
                    throw e2;
                throw e1; // use the first error not the second in case both fail
            }
        }
        await parsed.typecheck(schemas, options.loadMetadata);
        return parsed;
    } catch(e) {
        if (strict)
            throw e;
        return null;
    }
}

interface PredictionCandidate {
    code : string[];
}

function notNull<T>(x : T) : x is Exclude<T, null> {
    return x !== null;
}

export async function parseAllPredictions(candidates : PredictionCandidate[], entities : Syntax.EntityMap, options : ParseOptions) : Promise<Ast.Input[]> {
    return (await Promise.all(candidates.map((cand) => {
        return parsePrediction(cand.code, entities, options, false);
    }))).filter(notNull);
}

/**
 * Convert a program or dialogue state to a normalized sequence of tokens, suitable
 * to input to the neural network as context.
 */
export function serializeNormalized(program : Ast.Input|null, entities : Syntax.EntityMap = {}) : [string[], Syntax.EntityMap] {
    if (program === null)
        return [['null'], {}];

    // use UTC to compare dates for equality in normalized form
    // (this removes any ambiguity due to DST)
    const allocator = new Syntax.SequentialEntityAllocator(entities, { timezone: 'UTC' });
    const code : string[] = Syntax.serialize(program, Syntax.SyntaxType.Tokenized, allocator);
    return [code, entities];
}

interface SerializeOptions {
    locale : string;
    timezone : string|undefined;
    ignoreSentence ?: boolean;
    compatibility ?: string;
    includeEntityValue ?: boolean;
}

/**
 * Convert a program or dialogue state to a sequence of tokens to predict.
 */
export function serializePrediction(program : Ast.Input,
                                    sentence : string|string[],
                                    entities : Syntax.EntityMap,
                                    options : SerializeOptions) : string[] {
    const entityRetriever = new GenieEntityRetriever(typeof sentence === 'string' ? sentence.split(' ') : sentence, entities, {
        locale: options.locale,
        timezone: options.timezone,
        allowNonConsecutive: true,
        useHeuristics: true,
        alwaysAllowStrings: false,
        ignoreSentence: options.ignoreSentence || false,
    });
    return Syntax.serialize(program, Syntax.SyntaxType.Tokenized, entityRetriever, {
        compatibility: options.compatibility,
        includeEntityValue: options.includeEntityValue
    });
}
