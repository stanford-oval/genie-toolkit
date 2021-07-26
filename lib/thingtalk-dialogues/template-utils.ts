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

import * as I18n from '../i18n';
import { Replaceable } from '../utils/template-string';

import {
    SemanticAction,
    TemplatePlaceholderMap
} from '../sentence-generator/types';
import { NonTerminal } from '../sentence-generator/runtime';

function processPlaceholderMap(nonTerms : NonTerminal[], names : string[], placeholders : TemplatePlaceholderMap) {
    for (const alias in placeholders) {
        const symbol = placeholders[alias];
        if (symbol === null)
            return;
        names.push(alias);
        if (typeof symbol === 'string') {
            nonTerms.push(new NonTerminal(symbol, alias));
        } else if (!Array.isArray(symbol)) {
            // do something
            throw new Error('not implemented yet');
        } else if (symbol.length === 3) {
            nonTerms.push(new NonTerminal(symbol[0], alias, [symbol[1], symbol[2]]));
        } else {
            nonTerms.push(new NonTerminal(symbol[0], alias, [symbol[1], symbol[2], symbol[3]]));
        }
    }
}

interface SentenceGenerator {
    langPack : I18n.LanguagePack;

    addDynamicRule(nonTerms : NonTerminal[], repl : Replaceable, semantics : SemanticAction<any[], any>) : void;
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

    processPlaceholderMap(nonTerms, names, placeholders);
    let repl;
    try {
        repl = Replaceable.get(tmpl, generator.langPack, names);
    } catch(e) {
        throw new Error(`Failed to parse dynamic template string for ${tmpl} (${nonTerms.join(', ')}): ${e.message}`);
    }

    generator.addDynamicRule(nonTerms, repl, semantics);
}
