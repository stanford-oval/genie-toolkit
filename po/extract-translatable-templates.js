// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

process.on('unhandledRejection', (up) => { throw up; });

const assert = require('assert');

const { stringEscape } = require('../lib/utils/escaping');

const genieCompiler = require('../lib/sentence-generator/compiler');
const AstNodeVisitor = require('../lib/sentence-generator/compiler/visitor');

class Extractor extends AstNodeVisitor {
    constructor() {
        super();

        this._contexts = new Set;
        this._nonTerm = null;
    }

    visitContextStmt(stmt) {
        for (let name of stmt.names)
            this._contexts.add(name);
    }

    visitNonTerminalStmt(stmt) {
        this._nonTerm = stmt.name.name || stmt.name.code;
        return true;
    }

    _visitRule(rule) {
        const [str, comment, needsComment] = rule.getTranslationKey();
        if (!str)
            return true;

        if (needsComment)
            console.log(`/* ${comment} */`);
        console.log(`var x = pgettext(${stringEscape('template/' + this._nonTerm)}, ${stringEscape(str)});`);
        return true;
    }

    visitExpansionRule(rule) {
        // do not generate a translation if the rule only references a non-terminal
        // (with or without a context)
        if (rule.head.length === 1 && rule.head[0].isNonTerminal)
            return false;
        if (rule.head.length === 2 && rule.head[0].isNonTerminal && rule.head[1].isNonTerminal
            && this._contexts.has(rule.head[0].category.name))
            return false;

        return this._visitRule(rule);
    }
    visitReplacementRule(rule) {
        assert(rule.head[0].isNonTerminal);
        if (rule.head[1].isNonTerminal)
            return;
        return this._visitRule(rule);
    }

    // stubs that are called by the compiled templates
    addConstants() {
    }
    declareFunction() {
    }
    declareConstants() {
    }
    declareSymbol() {
    }
}

async function main() {
    const extractor = new Extractor();

    // compile everything
    await genieCompiler(process.argv[2]);

    // for every compiled file
    for (let { parsed } of Object.values(genieCompiler._importCache))
        parsed.visit(extractor);
}
main();
