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

const assert = require('assert');
const { stringEscape } = require('../../utils/escaping');

class Grammar {
    constructor(comment, statements) {
        this.comment = comment;
        this.statements = statements;
    }

    visit(visitor) {
        if (!visitor.visitGrammar(this))
            return;
        for (let stmt of this.statements)
            stmt.visit(visitor);
    }

    codegen() {
        let buffer = '';

        buffer += (this.comment);
        buffer += ('"use strict";\n');
        buffer += `return async function($options, $locale, $grammar) {`;
        for (let stmt of this.statements)
            buffer += stmt.codegen('   ');
        buffer += ('   return $grammar;\n');
        buffer += '};\n';

        return buffer;
    }
}
exports.Grammar = Grammar;

class Statement {}
exports.Statement = Statement;

class CodeBlock extends Statement {
    constructor(code) {
        super();
        this.isCodeBlock = true;
        this.code = code;
    }

    visit(visitor) {
        visitor.visitCodeBlock(this);
    }

    codegen() {
        return this.code;
    }
}
Statement.CodeBlock = CodeBlock;

class NonTerminalRef {}
exports.NonTerminalRef = NonTerminalRef;

class IdentifierNTR extends NonTerminalRef {
    constructor(name) {
        super();

        this.isIdentifier = true;
        this.name = name;
    }

    visit(visitor) {
        visitor.visitIdentifierNTR(this);
    }

    codegen() {
        return stringEscape(this.name);
    }
}
NonTerminalRef.Identifier = IdentifierNTR;

class ComputedNTR extends NonTerminalRef {
    constructor(nameCode) {
        super();

        this.isComputed = true;
        this.code = nameCode;
    }

    visit(visitor) {
        visitor.visitComputedNTR(this);
    }

    codegen() {
        return this.code;
    }
}
NonTerminalRef.Computed = ComputedNTR;

class NonTerminalStmt extends Statement {
    constructor(name, rules) {
        super();

        this.isNonTerminal = true;

        this.name = name;
        this.rules = rules;
    }

    visit(visitor) {
        if (!visitor.visitNonTerminalStmt(this))
            return;
        this.name.visit(visitor);
        for (let rule of this.rules)
            rule.visit(visitor);
    }

    codegen(prefix = '') {
        let buffer = '';
        buffer += (`${prefix}$grammar.declareSymbol(${this.name.codegen()});\n`);
        for (let rule of this.rules)
            buffer += rule.codegen(this.name, prefix);
        return buffer;
    }
}
Statement.NonTerminal = NonTerminalStmt;

class ContextStmt extends Statement {
    constructor(names) {
        super();

        this.isContext = true;
        this.names = names;
    }

    visit(visitor) {
        visitor.visitContextStmt(this);
    }

    codegen(prefix = '') {
        return this.names.map((name) => `${prefix}$grammar.declareContext(${stringEscape(name)});\n`).join('');
    }
}
Statement.Context = ContextStmt;

class FunctionDeclarationStmt extends Statement {
    constructor(name, args, code) {
        super();

        this.isContextTagger = true;
        this.name = name;
        this.args = args;
        this.code = code;
    }

    visit(visitor) {
        visitor.visitFunctionDeclarationStmt(this);
    }

    codegen(prefix = '') {
        return `${prefix}$grammar.declareFunction('${this.name}', (${this.args.join(', ')}) => {${this.code}});\n`;
    }
}
Statement.FunctionDeclaration = FunctionDeclarationStmt;

class ForLoop extends Statement {
    constructor(head, statements) {
        super();

        this.isForLoop = true;
        this.head = head;
        this.statements = statements;
    }

    visit(visitor) {
        if (!visitor.visitForLoop(this))
            return;

        for (let stmt of this.statements)
            stmt.visit(visitor);
    }

    codegen(prefix = '') {
        let buffer = '';
        buffer += (`${prefix}for (${this.head}) {\n`);
        for (let stmt of this.statements)
            buffer += stmt.codegen(prefix + '    ');
        buffer += (`${prefix}}\n`);
        return buffer;
    }
}
Statement.ForLoop = ForLoop;

class IfStmt extends Statement {
    constructor(cond, iftrue, iffalse) {
        super();

        this.isIf = true;
        this.cond = cond;
        this.iftrue = iftrue;
        this.iffalse = iffalse;
    }

    visit(visitor) {
        if (!visitor.visitIfStmt(this))
            return;
        for (let stmt of this.iftrue)
            stmt.visit(visitor);
        for (let stmt of this.iffalse)
            stmt.visit(visitor);
    }

    codegen(prefix = '') {
        let buffer = '';
        buffer += (`${prefix}if (${this.cond}) {\n`);
        for (let stmt of this.iftrue)
            buffer += stmt.codegen(prefix + '    ');
        if (this.iffalse.length > 0) {
            buffer += (`${prefix}} else {\n`);
            for (let stmt of this.iffalse)
                buffer += stmt.codegen(prefix + '    ');
        }
        buffer += (`${prefix}}\n`);
        return buffer;
    }
}
Statement.If = IfStmt;

class Import extends Statement {
    constructor(what) {
        super();

        this.isImport = true;
        this.what = what;
    }

    visit(visitor) {
        visitor.visitImport(this);
    }

    codegen(prefix = '') {
        return `${prefix}$grammar = await $import(${stringEscape(this.what)})($options, $locale, $grammar);\n`;
    }
}
Statement.Import = Import;

class RuleAttributes {
    constructor(attributes = []) {
        this.attributes = attributes;
    }

    visit(visitor) {
        visitor.visitRuleAttributes(this);
    }

    codegen() {
        let buf = '{ ';
        buf += this.attributes.map((attr) => `${attr.name}: (${attr.code})`).join(', ');
        buf += ' }';
        return buf;
    }
}
exports.RuleAttributes = RuleAttributes;

class Rule {}
exports.Rule = Rule;

class ConstantsRule extends Rule {
    constructor(token, typeCode, prefix, suffix, attrs) {
        super();

        this.isConstants = true;
        this.token = token;
        this.typeCode = typeCode;
        this.prefix = prefix;
        this.suffix = suffix;
        this.attrs = attrs;
    }

    visit(visitor) {
        visitor.visitConstantsRule(this);
    }

    codegen(nonTerminal, prefix = '') {
        return `${prefix}$grammar.addConstants(${nonTerminal.codegen()}, ${stringEscape(this.token)}, ${this.typeCode}, ${stringEscape(this.prefix)}, ${stringEscape(this.suffix)}, ${this.attrs.codegen()});\n`;
    }
}
Rule.Constants = ConstantsRule;

function makeBodyLambda(head, body) {
    const bodyArgs = [];
    let i = 0;
    for (let headPart of head) {
        if (headPart.name)
            bodyArgs.push(headPart.name);
        else
            bodyArgs.push(`$${i++}`);
    }

    return `(${bodyArgs.join(', ')}) => ${body}`;
}

function getTranslationKey(expansion) {
    let str = '';
    let comment = '';
    let positionalIdx = 0;
    let needsComment = false;

    for (const part of expansion) {
        if (str)
            str += ' ';
        if (comment)
            comment += ' ';
        if (part.isStringLiteral) {
            str += part.value;
            comment += part.value;
        } else if (part.isComputedStringLiteral) {
            str += '${' + String(positionalIdx++) + '}';
            comment += '${' + part.code + '}';
            needsComment = true;
        } else if (part.isNonTerminal && part.category.isIdentifier) {
            str += '${' + part.category.name + '}';
            comment += '${' + part.category.name + '}';
        } else if (part.isNonTerminal && part.category.isComputed) {
            str += '${' + String(positionalIdx++) + '}';
            comment += '${' + part.category.code + '}';
            needsComment = true;
        } else if (part.isChoice) {
            str += '{' + part.values.join('|') + '}';
            comment += '{' + part.values.join('|') + '}';
        } else {
            throw new TypeError();
        }
    }

    return [str, comment, needsComment];
}

class ExpansionRule extends Rule {
    constructor(head, body, condition, attrs) {
        super();
        assert(Array.isArray(head));

        this.isExpansion = true;
        this.head = head;
        this.bodyCode = body;
        this.conditionCode = condition;
        this.attrs = attrs;
    }

    visit(visitor) {
        if (!visitor.visitExpansionRule(this))
            return;

        for (let head of this.head)
            head.visit(visitor);
    }

    getTranslationKey() {
        return getTranslationKey(this.head);
    }

    codegen(nonTerminal, prefix = '') {
        const expanderCode = makeBodyLambda(this.head, this.bodyCode);

        return `${prefix}$grammar.addRule(${nonTerminal.codegen()}, [${this.head.map((h) => h.codegen()).join(', ')}], $runtime.simpleCombine((${expanderCode}), ${this.conditionCode ? stringEscape(this.conditionCode) : 'null'}, ${nonTerminal.isIdentifier && nonTerminal.name === '$root'}), ${this.attrs.codegen()});\n`;
    }
}
Rule.Expansion = ExpansionRule;

class ConditionRule extends Rule {
    constructor(flag, rules) {
        super();

        this.isCondition = true;
        this.flag = flag;
        this.rules = rules;
    }

    visit(visitor) {
        if (!visitor.visitConditionRule(this))
            return;

        for (let rule of this.rules)
            rule.visit(visitor);
    }

    codegen(nonTerminal, prefix = '') {
        let flag = this.flag.startsWith('?') ?
            `$options.flags.${this.flag.substring(1)}` :
            `!$options.flags.${this.flag.substring(1)}`;

        let buffer = '';
        buffer += (`${prefix}if (${flag}) {\n`);
        for (let rule of this.rules)
            buffer += rule.codegen(nonTerminal, prefix + '    ');
        buffer += (`${prefix}}\n`);
        return buffer;
    }
}
Rule.Condition = ConditionRule;

class ReplacementRule extends Rule {
    constructor(head, placeholder, bodyCode, optionCode, attrs) {
        super();

        this.isReplacement = true;
        this.head = head;
        this.placeholder = placeholder;
        this.bodyCode = bodyCode;
        this.optionCode = optionCode;
        this.attrs = attrs;
    }

    getTranslationKey() {
        return getTranslationKey(this.head);
    }

    visit(visitor) {
        if (!visitor.visitReplacementRule(this))
            return;

        for (let head of this.head)
            head.visit(visitor);
    }

    codegen(nonTerminal, prefix = '') {
        const expanderCode = makeBodyLambda(this.head, this.bodyCode);

        return (`${prefix}$grammar.addRule(${nonTerminal.codegen()}, [${this.head.map((h) => h.codegen()).join(', ')}], $runtime.combineReplacePlaceholder(${this.placeholder}, (${expanderCode}), ${this.optionCode}), ${this.attrs.codegen()});\n`);
    }
}
Rule.Replacement = ReplacementRule;

class RuleHeadPart {}
exports.RuleHeadPart = RuleHeadPart;

class NonTerminalRuleHead extends RuleHeadPart {
    constructor(name, category) {
        super();

        this.isNonTerminal = true;
        this.name = name;
        this.category = category;
    }

    visit(visitor) {
        visitor.visitNonTerminalRuleHead(this);
    }

    codegen() {
        return `new $runtime.NonTerminal(${this.category.codegen()})`;
    }
}
RuleHeadPart.NonTerminal = NonTerminalRuleHead;

class StringLiteralRuleHead extends RuleHeadPart {
    constructor(value) {
        super();

        this.isStringLiteral = true;
        this.value = value;
    }

    visit(visitor) {
        visitor.visitStringLiteralRuleHead(this);
    }

    codegen() {
        return stringEscape(this.value);
    }
}
RuleHeadPart.StringLiteral = StringLiteralRuleHead;

class ComputedStringLiteralRuleHead extends RuleHeadPart {
    constructor(code) {
        super();

        this.isComputedStringLiteral = true;
        this.code = code;
    }

    visit(visitor) {
        visitor.visitComputedStringLiteralRuleHead(this);
    }

    codegen() {
        return this.code;
    }
}
RuleHeadPart.ComputedStringLiteral = ComputedStringLiteralRuleHead;

class ChoiceRuleHead extends RuleHeadPart {
    constructor(values) {
        super();

        this.isChoice = true;
        this.values = values;
    }

    visit(visitor) {
        visitor.visitChoiceRuleHead(this);
    }

    codegen() {
        return `new $runtime.Choice([${this.values.map(stringEscape).join(', ')}])`;
    }
}
RuleHeadPart.Choice = ChoiceRuleHead;
