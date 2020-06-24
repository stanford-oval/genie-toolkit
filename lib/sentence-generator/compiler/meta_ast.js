// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const { stringEscape } = require('../../utils/escaping');

class Grammar {
    constructor(comment, statements) {
        this.comment = comment;
        this.statements = statements;
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

    codegen() {
        return this.code;
    }
}
NonTerminalRef.Computed = ComputedNTR;

class NonTerminalStmt extends Statement {
    constructor(name, rules) {
        super();

        this.isNonTerminal = true;

        // $user is the same as $root, and it's introduced for symmetry with $agent
        if (name === '$user')
            name = '$root';
        this.name = name;
        this.rules = rules;
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

    codegen(prefix = '') {
        return this.names.map((name) => `${prefix}$grammar.declareContext(${stringEscape(name)});\n`).join('');
    }
}
Statement.Context = ContextStmt;

class ContextTaggerStmt extends Statement {
    constructor(pname, code) {
        super();

        this.isContextTagger = true;
        this.pname = pname;
        this.code = code;
    }

    codegen(prefix = '') {
        return `${prefix}$grammar.setContextTagger((${this.pname}) => {${this.code}});\n`;
    }
}
Statement.ContextTagger = ContextTaggerStmt;

class ForLoop extends Statement {
    constructor(head, statements) {
        super();

        this.isForLoop = true;
        this.head = head;
        this.statements = statements;
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

    codegen(prefix = '') {
        return `${prefix}$grammar = await $import(${stringEscape(this.what)})($options, $locale, $grammar);\n`;
    }
}
Statement.Import = Import;

class RuleAttributes {
    constructor(attributes = []) {
        this.attributes = attributes;
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

class Constants extends Rule {
    constructor(token, typeCode, attrs) {
        super();

        this.isConstants = true;
        this.token = token;
        this.typeCode = typeCode;
        this.attrs = attrs;
    }

    codegen(nonTerminal, prefix = '') {
        return `${prefix}$grammar.addConstants(${nonTerminal.codegen()}, ${stringEscape(this.token)}, ${this.typeCode}, ${this.attrs.codegen()});\n`;
    }
}
Rule.Constants = Constants;

function makeBodyLambda(head, body) {
    const bodyArgs = [];
    let i = 0;
    for (let headPart of head) {
        if (!headPart.isNonTerminal)
            continue;
        if (headPart.name)
            bodyArgs.push(headPart.name);
        else
            bodyArgs.push(`$${i++}`);
    }

    return `(${bodyArgs.join(', ')}) => ${body}`;
}

class Expansion extends Rule {
    constructor(head, body, condition, attrs) {
        super();
        assert(Array.isArray(head));

        this.isExpansion = true;
        this.head = head;
        this.bodyCode = body;
        this.conditionCode = condition;
        this.attrs = attrs;
    }

    codegen(nonTerminal, prefix = '') {
        const expanderCode = makeBodyLambda(this.head, this.bodyCode);

        return `${prefix}$grammar.addRule(${nonTerminal.codegen()}, [${this.head.map((h) => h.codegen()).join(', ')}], $runtime.simpleCombine((${expanderCode}), ${this.conditionCode ? stringEscape(this.conditionCode) : 'null'}, ${nonTerminal.isIdentifier && nonTerminal.name === '$root'}), ${this.attrs.codegen()});\n`;
    }
}
Rule.Expansion = Expansion;

class Condition extends Rule {
    constructor(flag, rules) {
        super();

        this.isCondition = true;
        this.flag = flag;
        this.rules = rules;
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
Rule.Condition = Condition;

class Replacement extends Rule {
    constructor(head, placeholder, bodyCode, optionCode, attrs) {
        super();

        this.isReplacement = true;
        this.head = head;
        this.placeholder = placeholder;
        this.bodyCode = bodyCode;
        this.optionCode = optionCode;
        this.attrs = attrs;
    }

    codegen(nonTerminal, prefix = '') {
        const expanderCode = makeBodyLambda(this.head, this.bodyCode);

        return (`${prefix}$grammar.addRule(${nonTerminal.codegen()}, [${this.head.map((h) => h.codegen()).join(', ')}], $runtime.combineReplacePlaceholder(${this.placeholder}, (${expanderCode}), ${this.optionCode}), ${this.attrs.codegen()});\n`);
    }
}
Rule.Replacement = Replacement;

class RuleHeadPart {}
exports.RuleHeadPart = RuleHeadPart;

class NonTerminalRuleHead extends RuleHeadPart {
    constructor(name, category) {
        super();

        this.isNonTerminal = true;
        this.name = name;
        this.category = category;
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

    codegen() {
        return `new $runtime.Choice([${this.values.map(stringEscape).join(', ')}])`;
    }
}
RuleHeadPart.Choice = ChoiceRuleHead;
