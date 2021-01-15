// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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

process.on('unhandledRejection', (up) => { throw up; });

import assert from 'assert';

import { stringEscape } from '../lib/utils/escaping';

import { Compiler } from '../lib/sentence-generator/compiler';
import * as metaast from '../lib/sentence-generator/compiler/meta_ast';

class Extractor extends metaast.NodeVisitor {
    private _contexts : Set<string>;
    private _nonTerm : string|null;

    constructor() {
        super();

        this._contexts = new Set;
        this._nonTerm = null;
    }

    visitContextStmt(stmt : metaast.ContextStmt) {
        for (const name of stmt.names)
            this._contexts.add(name);
    }

    visitNonTerminalStmt(stmt : metaast.NonTerminalStmt) {
        this._nonTerm = stmt.name instanceof metaast.IdentifierNTR ? stmt.name.name : stmt.name.code;
        return true;
    }

    private _visitRule(rule : metaast.Expansion|metaast.Replacement) {
        const [str, comment, needsComment] = rule.getTranslationKey();
        if (!str)
            return;

        if (needsComment)
            console.log(`/* ${comment} */`);
        console.log(`var x = pgettext(${stringEscape('template/' + this._nonTerm)}, ${stringEscape(str)});`);
    }

    visitExpansionRule(rule : metaast.Expansion) {
        // do not generate a translation if the rule only references a non-terminal
        if (rule.head.length === 1 && rule.head[0] instanceof metaast.NonTerminalRuleHead)
            return;

        this._visitRule(rule);
    }
    visitReplacementRule(rule : metaast.Replacement) {
        assert(rule.head[0] instanceof metaast.NonTerminalRuleHead);
        if (rule.head[1] instanceof metaast.NonTerminalRuleHead)
            return;
        this._visitRule(rule);
    }
}

async function main() {
    const extractor = new Extractor();

    // compile everything
    const compiler = new Compiler('ts');
    await compiler.parse(process.argv[2]);
    compiler.visit(extractor);
}
main();
