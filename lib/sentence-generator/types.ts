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
import { SchemaRetriever, Syntax, Ast } from 'thingtalk';

import { Hashable } from '../utils/hashmap';
import { PlaceholderReplacement, ReplacedResult } from '../utils/template-string';
import type { NonTerminal } from './runtime';

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

// options passed to the templates
export interface GrammarOptions {
    thingpediaClient : Tp.BaseClient;
    schemaRetriever : SchemaRetriever;
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
 * Equality of key compared to another non-terminal.
 *
 * The values are [our index name, the 0-based position of the other non-terminal, the other index name].
 */
export type RelativeKeyConstraint = [string, number, string];

/**
 * Equality of key compared to a constant value.
 *
 * The constraint store [our index name, the comparison value].
 */
export type ConstantKeyConstraint = [string, DerivationKeyValue];

/**
 * A constraint on the content of a non-terminal.
 *
 * Constraints are expressed using the `<>` syntax in the Genie template
 * language, and are used to speed-up synthesis by avoiding repeated calls
 * to the semantic function.
 */
export type NonTerminalKeyConstraint = RelativeKeyConstraint | ConstantKeyConstraint;

/**
 * A mapping defining the meaning of placeholders in a template.
 *
 * `null` is allowed in the mapping for convenience. If any replacement is `null`,
 * the whole template is discarded.
 */
export type TemplatePlaceholderMap = Record<string, NonTerminal|PlaceholderReplacement|ReplacedResult|string|null>

/**
 * A single template for synthesis.
 *
 * This consists of a phrase with placeholders and a semantic function to compute the
 * formal representation. The arguments to the semantic function depend on the declared
 * placeholders, and the purpose of the template.
 */
export type Template<ArgTypes extends unknown[], ReturnType> =
    [string, TemplatePlaceholderMap, SemanticAction<ArgTypes, ReturnType>];

/**
 * A textual reply from the agent.
 */
export type AgentTextMessage = {
    type : 'text';
    text : string;
    args : TemplatePlaceholderMap;
    meaning : SemanticAction<any[], AgentReplyRecord|undefined>
};

/**
 * A non-textual reply from the agent.
 */
export type AgentExtensionMessage = {
    type : 'link';
    args : TemplatePlaceholderMap;
    title : string;
    url : string;
} | {
    type : 'picture'|'audio'|'video';
    args : TemplatePlaceholderMap;
    url : string;
    alt ?: string;
} | {
    type : 'button';
    args : TemplatePlaceholderMap;
    title : string;
    json : string;
} | {
    type : 'sound';
    args : TemplatePlaceholderMap;
    name : string;
    exclusive ?: boolean;
} | {
    type : 'rdl';
    args : TemplatePlaceholderMap;
    displayTitle : string;
    displayText ?: string;
    callback ?: string;
    webCallback ?: string;
    pictureUrl ?: string;
};
// TODO add the other message types

/**
 * A single piece of the reply from the agent at one turn.
 *
 * This is either a text message, or a link/card/other non-textual
 * element.
 */
export type AgentMessage = AgentTextMessage | AgentExtensionMessage;

/**
 * The reply of the agent at one turn.
 *
 * This is an array of messages, concatenated together, expressed
 * in the form of templates. The last non-void semantics are used
 * as the overall semantics of the turn.
 */
export type AgentReply = AgentMessage[];

/**
 * Formally represent a single concrete action taken by the agent at this turn.
 */
export interface AgentReplyRecord {
    /**
     * The formal representation of the agent utterance in ThingTalk.
     */
    meaning : Ast.DialogueState;

    /**
     * The number of results that the agent is talking about at this turn.
     *
     * This affects the presentation of non-textual elements (cards, media objects)
     * associated with this agent turn.
     */
    numResults : number;
}
