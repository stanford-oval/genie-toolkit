// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

/**
 * Utilities for converting dynamic templates to rules in a {@link SentenceGenerator}
 */

import assert from 'assert';
import { Ast } from 'thingtalk';
import {
    Concatenation,
    PlaceholderReplacement,
    Replaceable,
    ReplacedResult,
    ReplacementContext
} from '../utils/template-string';

import type SentenceGenerator from '../sentence-generator/generator';
import type InferenceSentenceGenerator from './inference-sentence-generator';
import {
    AgentExtensionMessage,
    AgentReply,
    AgentTextMessage,
    SemanticAction,
    Template,
    TemplatePlaceholderMap
} from '../sentence-generator/types';
import { NonTerminal } from '../sentence-generator/runtime';

function processPlaceholderMap(tmpl : string,
                               generator : SentenceGenerator|InferenceSentenceGenerator,
                               nonTerms : NonTerminal[],
                               placeholders : TemplatePlaceholderMap) {
    let needsReplacePartial = false;
    const replacePartialCtx : ReplacementContext & { replacements : Array<PlaceholderReplacement|undefined|null> } = {
        replacements: [],
        constraints: {}
    };
    const offset = nonTerms.length;
    const nonTermNames : string[] = [];
    const allNames : string[] = [];

    for (const alias in placeholders) {
        const symbol = placeholders[alias];
        allNames.push(alias);
        if (symbol === null) {
            needsReplacePartial = true;
            replacePartialCtx.replacements.push(null);
        } else if (symbol instanceof NonTerminal) {
            nonTermNames.push(alias);
            nonTerms.push(symbol.withName(alias));
            replacePartialCtx.replacements.push(undefined);
        } else if (symbol instanceof ReplacedResult) {
            needsReplacePartial = true;
            replacePartialCtx.replacements.push({ value: symbol, text: symbol });
        } else if (typeof symbol === 'string') {
            needsReplacePartial = true;
            replacePartialCtx.replacements.push({ value: symbol, text: generator.tpLoader.describer.getEntity('QUOTED_STRING', symbol) });
        } else if (typeof symbol === 'number') {
            needsReplacePartial = true;
            replacePartialCtx.replacements.push({ value: symbol, text: generator.tpLoader.describer.getEntity('NUMBER', symbol) });
        } else if (symbol instanceof Ast.Value) {
            needsReplacePartial = true;
            const description = generator.tpLoader.describer.describeArg(symbol);
            if (description === null)
                replacePartialCtx.replacements.push(null);
            else
                replacePartialCtx.replacements.push({ value: symbol.toJS(), text: description });
        } else {
            needsReplacePartial = true;
            replacePartialCtx.replacements.push(symbol);
        }
    }

    // first preprocess using all names (both non terminals and constants)
    // and no offset
    let repl;
    try {
        repl = Replaceable.get(tmpl, generator.langPack, allNames);
    } catch(e) {
        throw new Error(`Failed to parse dynamic template string for ${tmpl} (${nonTerms.join(', ')}): ${e.message}`);
    }
    // if we have any constants to replace, do the replacement here
    if (needsReplacePartial) {
        repl = repl.replacePartial(replacePartialCtx);
        if (repl === null)
            return null;
    }
    // if we replaced any constant, or if we had an offset for the non terminal
    // indices, renumber all placeholders
    if (needsReplacePartial || offset > 0) {
        // preprocess again to adjust the non-terminal numbers

        // note that replacePartial creates clones so it is ok
        // to modify in place without a clone
        if (!needsReplacePartial)
            repl = repl.clone();
        repl.preprocess(generator.langPack, nonTermNames, offset);
    }
    return repl;
}

export function addTemplate(
    generator : SentenceGenerator|InferenceSentenceGenerator,
    prependNonTerminals : NonTerminal[],
    tmpl : string,
    placeholders : TemplatePlaceholderMap,
    semantics : SemanticAction<any[], any>) {
    const nonTerms : NonTerminal[] = [...prependNonTerminals];

    const repl = processPlaceholderMap(tmpl, generator, nonTerms, placeholders);
    if (repl === null)
        return;
    generator.addDynamicRule(nonTerms, repl, semantics);
}

export function addConcatenationTemplate<PartialSemantics, OverallSemantics = PartialSemantics>(
    generator : SentenceGenerator|InferenceSentenceGenerator,
    prependNonTerminals : NonTerminal[],
    templates : Array<Template<any[], PartialSemantics>>,
    combineSemantics : (current : OverallSemantics|undefined, next : PartialSemantics) => OverallSemantics) {
    const nonTerms : NonTerminal[] = [...prependNonTerminals];
    const replaceables : Replaceable[] = [];
    const semantics : Array<SemanticAction<any[], PartialSemantics>> = [];
    const offsets : number[] = [];

    for (const template of templates) {
        offsets.push(nonTerms.length);
        const [thisTmpl, thisPlaceholderMap, thisSemantics] = template;
        const repl = processPlaceholderMap(thisTmpl, generator, nonTerms, thisPlaceholderMap);
        if (repl === null)
            return;
        replaceables.push(repl);
        semantics.push(thisSemantics);
    }
    assert(replaceables.length > 0);

    generator.addDynamicRule(nonTerms, new Concatenation(replaceables, {}, {}), (...args : any[]) => {
        let overallMeaning : OverallSemantics|undefined = undefined;

        for (let i = 0; i < semantics.length; i++) {
            const partialMeaning = semantics[i](...args.slice(offsets[i], i < offsets.length ? offsets[i+1] : undefined));
            if (partialMeaning === null)
                return null;
            overallMeaning = combineSemantics(overallMeaning, partialMeaning);
        }
        assert(overallMeaning !== undefined);

        return overallMeaning;
    });
}

/**
 * Split a reply from the agent in three parts:
 * - non-textual replies to be returned first
 * - the main textual reply from the agent (which also has the meaning of this turn)
 * - other reply elements from the agent (which can be textual or not)
 *
 * @param replies
 */
export function splitAgentReply(replies : AgentReply) {
    const before : AgentExtensionMessage[] = [];
    const main : AgentTextMessage[] = [];
    const after : AgentReply = [];

    for (const msg of replies) {
        if (msg.type !== 'text') {
            if (main.length === 0)
                before.push(msg);
            else
                after.push(msg);
        } else {
            if (after.length === 0)
                main.push(msg);
            else
                after.push(msg);
        }
    }

    return [before, main, after] as const;
}
