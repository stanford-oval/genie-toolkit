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

/**
 * Utilities for converting dynamic templates to rules in a {@link SentenceGenerator}
 */

 import {
    PlaceholderReplacement,
    Replaceable,
    ReplacedResult,
    ReplacementContext
} from '../utils/template-string';

import type SentenceGenerator from '../sentence-generator/generator';
import {
    SemanticAction,
    TemplatePlaceholderMap
} from '../sentence-generator/types';
import { NonTerminal } from '../sentence-generator/runtime';
import { Ast } from 'thingtalk';

function processPlaceholderMap(tmpl : string,
                               generator : SentenceGenerator,
                               nonTerms : NonTerminal[],
                               names : string[],
                               placeholders : TemplatePlaceholderMap) {
    let needsReplacePartial = false;
    const replacePartialCtx : ReplacementContext & { replacements : Array<PlaceholderReplacement|undefined|null> } = {
        replacements: [],
        constraints: {}
    };
    const nonTermNames = [...names];

    for (const alias in placeholders) {
        const symbol = placeholders[alias];
        names.push(alias);
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
        } else if (symbol instanceof Ast.Value) {
            needsReplacePartial = true;
            const text = generator.tpLoader.describer.describeArg(symbol);
            if (text === null)
                replacePartialCtx.replacements.push(null);
            else
                replacePartialCtx.replacements.push({ value: symbol, text });
        } else {
            needsReplacePartial = true;
            replacePartialCtx.replacements.push(symbol);
        }
    }

    let repl;
    try {
        repl = Replaceable.get(tmpl, generator.langPack, names);
    } catch(e) {
        throw new Error(`Failed to parse dynamic template string for ${tmpl} (${nonTerms.join(', ')}): ${e.message}`);
    }
    if (needsReplacePartial) {
        repl = repl.replacePartial(replacePartialCtx);
        if (repl === null)
            return null;
        // preprocess again to adjust the non-terminal numbers
        // this is ok because replacePartial created clones
        repl.preprocess(generator.langPack, nonTermNames);
    }
    return repl;
}

export function addTemplate(generator : SentenceGenerator,
                            prependNonTerminals : NonTerminal[],
                            tmpl : string,
                            placeholders : TemplatePlaceholderMap,
                            semantics : SemanticAction<any[], any>) {
    const nonTerms : NonTerminal[] = [];
    const names : string[] = [];

    for (let i = 0; i < prependNonTerminals.length; i++) {
        nonTerms.push(prependNonTerminals[i]);
        names.push(prependNonTerminals[i].name ?? `_${i+1}`);
    }

    const repl = processPlaceholderMap(tmpl, generator, nonTerms, names, placeholders);
    if (repl === null)
        return;
    generator.addDynamicRule(nonTerms, repl, semantics);
}