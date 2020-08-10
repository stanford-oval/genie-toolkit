// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

module.exports = class AstNodeVisitor {
    visitGrammar(node) {
        return true;
    }

    visitCodeBlock(node) {
        return true;
    }

    visitIdentifierNTR(node) {
        return true;
    }
    visitComputedNTR(node) {
        return true;
    }

    visitNonTerminalStmt(node) {
        return true;
    }
    visitContextStmt(node) {
        return true;
    }
    visitFunctionDeclarationStmt(node) {
        return true;
    }
    visitForLoop(node) {
        return true;
    }
    visitIfStmt(node) {
        return true;
    }
    visitImport(node) {
        return true;
    }

    visitRuleAttributes(node) {
        return true;
    }

    visitConstantsRule(node) {
        return true;
    }
    visitExpansionRule(node) {
        return true;
    }
    visitConditionRule(node) {
        return true;
    }
    visitReplacementRule(node) {
        return true;
    }

    visitNonTerminalRuleHead(node) {
        return true;
    }
    visitStringLiteralRuleHead(node) {
        return true;
    }
    visitComputedStringLiteralRuleHead(node) {
        return true;
    }
    visitChoiceRuleHead(node) {
        return true;
    }
};
