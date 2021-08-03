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
import { Type, SchemaRetriever, Syntax, Ast } from 'thingtalk';

import * as I18n from '../i18n';
import { Hashable } from '../utils/hashmap';
import { ReplacedResult } from '../utils/template-string';
import type SentenceGenerator from './generator';
import type { SentenceGeneratorOptions } from './generator';
import type ThingpediaLoader from '../templates/load-thingpedia';

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
    utterance : ReplacedResult;
    value : unknown;
    context : unknown;
    priority ?: number;
    key : DerivationKey;
}

export type ContextTable = Record<string, number>;

export interface AgentReplyRecord {
    state : Ast.DialogueState;
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
    contextual : boolean;
    flags : { [key : string] : boolean };
    onlyDevices ?: string[];
    whiteList ?: string;
    debug : number;
    timezone : string|undefined;
}

/**
 * A statically-defined non-terminal in a Genie template file.
 *
 * This type exists only for documentation.
 */
export type NonTerminal<ValueType> = ValueType extends unknown ? string : never;
// ^ clever hack with dual purposes: it shuts up typescript about
// an unused type argument, and it hides the type definition from typedoc

/**
 * The abstract interface of a dialogue policy module.
 *
 * This interface defines the functions that a policy module should export.
 */
export interface PolicyModule {
    /**
     * The policy manifest.
     *
     * This is used to check the generated dialogue states for correctness.
     */
    MANIFEST : {
        name : string,
        terminalAct : string,
        dialogueActs : {
            user : readonly string[],
            agent : readonly string[],
            withParam : readonly string[]
        },
    },

    initializeTemplates(agentOptions : SentenceGeneratorOptions, langPack : I18n.LanguagePack, grammar : SentenceGenerator, tpLoader : ThingpediaLoader) : Promise<void>;

    getContextPhrasesForState(state : Ast.DialogueState|null, tpLoader : ThingpediaLoader, contextTable : ContextTable) : ContextPhrase[]|null;

    interpretAnswer?(state : Ast.DialogueState, value : Ast.Value, tpLoader : ThingpediaLoader, contextTable : ContextTable) : Ast.DialogueState|null;

    initialState?(tpLoader : ThingpediaLoader) : Ast.DialogueState|null;

    notification?(appName : string | null, program : Ast.Program, result : Ast.DialogueHistoryResultItem) : Ast.DialogueState|null;
    notifyError?(appName : string | null, program : Ast.Program, error : Ast.Value) : Ast.DialogueState|null;

    getFollowUp?(state : Ast.DialogueState, tpLoader : ThingpediaLoader, contextTable : ContextTable) : Ast.DialogueState|null;
}
