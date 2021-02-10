// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as Tp from 'thingpedia';
import { Type, SchemaRetriever, Syntax } from 'thingtalk';

import { Hashable } from '../utils/hashmap';

export interface RuleAttributes {
    weight ?: number;
    priority ?: number;
    repeat ?: boolean;
    forConstant ?: boolean;
    temporary ?: boolean;
    identity ?: boolean;
    expandchoice ?: boolean;
}

export type DerivationKeyValue = string|number|boolean|null|Hashable<unknown>;

/**
 * A compound key used to efficiently index compatible keys.
 *
 * This is a record of index names and hashable keys.
 * The generation algorithm keeps track of an index (hash table) for
 * every known index name.
 */
export type DerivationKey = Record<string, DerivationKeyValue>;

export type SemanticAction<ArgType extends unknown[], ReturnType> = (...args : ArgType) => ReturnType|null;
export type KeyFunction<ValueType> = (value : ValueType) => DerivationKey;

export interface ContextPhrase {
    symbol : number;
    utterance : string;
    value : unknown;
    priority ?: number;
    key : DerivationKey;
}

export type ContextTable = Record<string, number>;

export type ContextFunction<StateType> = (state : StateType|null, contextSymbols : ContextTable) => ContextPhrase[]|null;

export interface AgentReplyRecord<StateType> {
    state : StateType;
    context : any;
    contextPhrases : ContextPhrase[];
    expect : Type|null;
    end : boolean;
    raw : boolean;
    numResults : number;
}

// options passed to the templates
export interface GrammarOptions {
    thingpediaClient : Tp.BaseClient;
    schemaRetriever ?: SchemaRetriever;
    entityAllocator : Syntax.SequentialEntityAllocator;
    forSide : 'user'|'agent';
    flags : { [key : string] : boolean };
    onlyDevices ?: string[];
    whiteList ?: string;
    debug : number;
    timezone : string|undefined;
}
