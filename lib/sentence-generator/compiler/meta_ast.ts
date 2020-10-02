// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import assert from 'assert';
import { stringEscape } from '../../utils/escaping';

export class Grammar {
    constructor(public comment : string,
                public statements : Statement[]) {
    }

    codegen(runtimepath : string) : string {
        let buffer = '';

        buffer += (this.comment);
        for (const stmt of this.statements) {
            if (stmt instanceof JSImportStmt)
                buffer += stmt.codegen();
        }
        buffer += `import type { SentenceGeneratorRuntime } from "genie-toolkit";\n`;
        buffer += `export default async function($runtime : typeof SentenceGeneratorRuntime, $options : any, $locale : any, $grammar : any) : Promise<void> {\n`;
        for (const stmt of this.statements) {
            if (stmt instanceof JSImportStmt)
                continue;
            buffer += stmt.codegen('   ');
        }
        buffer += '};\n';

        return buffer;
    }
}

export abstract class Statement {
    static CodeBlock : typeof CodeBlock;
    static JSImportStmt : typeof JSImportStmt;
    static NonTerminal : typeof NonTerminalStmt;
    static Context : typeof ContextStmt;
    static FunctionDeclaration : typeof FunctionDeclarationStmt;
    static ForLoop : typeof ForLoop;
    static If : typeof IfStmt;
    static Import : typeof Import;

    abstract codegen(prefix ?: string) : string;
}

export class CodeBlock extends Statement {
    constructor(public code : string) {
        super();
    }

    codegen() : string {
        return this.code;
    }
}
Statement.CodeBlock = CodeBlock;

export class JSImportStmt extends Statement {
    constructor(public code : string) {
        super();
    }

    codegen() : string {
        return `import ${this.code};\n`;
    }
}
Statement.JSImportStmt = JSImportStmt;

export abstract class NonTerminalRef {
    static Identifier : typeof IdentifierNTR;
    static Computed : typeof ComputedNTR;

    abstract codegen() : string;
}

export class IdentifierNTR extends NonTerminalRef {
    constructor(public name : string) {
        super();
    }

    codegen() : string {
        return stringEscape(this.name);
    }
}
NonTerminalRef.Identifier = IdentifierNTR;

export class ComputedNTR extends NonTerminalRef {
    constructor(public code : string) {
        super();
    }

    codegen() : string {
        return this.code;
    }
}
NonTerminalRef.Computed = ComputedNTR;

export class NonTerminalStmt extends Statement {
    constructor(public name : NonTerminalRef,
                public rules : Rule[]) {
        super();
    }

    codegen(prefix = '') : string {
        let buffer = '';
        buffer += (`${prefix}$grammar.declareSymbol(${this.name.codegen()});\n`);
        for (const rule of this.rules)
            buffer += rule.codegen(this.name, prefix);
        return buffer;
    }
}
Statement.NonTerminal = NonTerminalStmt;

export class ContextStmt extends Statement {
    constructor(public names : string[]) {
        super();
    }

    codegen(prefix = '') : string {
        return this.names.map((name) => `${prefix}$grammar.declareContext(${stringEscape(name)});\n`).join('');
    }
}
Statement.Context = ContextStmt;

export class FunctionDeclarationStmt extends Statement {
    constructor(public name : string,
                public args : string[],
                public code : string) {
        super();
    }

    codegen(prefix = '') : string {
        return `${prefix}$grammar.declareFunction('${this.name}', (${this.args.join(', ')}) => {${this.code}});\n`;
    }
}
Statement.FunctionDeclaration = FunctionDeclarationStmt;

export class ForLoop extends Statement {
    constructor(public head : string,
                public statements : Statement[]) {
        super();
    }

    codegen(prefix = '') : string {
        let buffer = '';
        buffer += (`${prefix}for (${this.head}) {\n`);
        for (const stmt of this.statements)
            buffer += stmt.codegen(prefix + '    ');
        buffer += (`${prefix}}\n`);
        return buffer;
    }
}
Statement.ForLoop = ForLoop;

export class IfStmt extends Statement {
    constructor(public cond : string,
                public iftrue : Statement[],
                public iffalse : Statement[]) {
        super();
    }

    codegen(prefix = '') : string {
        let buffer = '';
        buffer += (`${prefix}if (${this.cond}) {\n`);
        for (const stmt of this.iftrue)
            buffer += stmt.codegen(prefix + '    ');
        if (this.iffalse.length > 0) {
            buffer += (`${prefix}} else {\n`);
            for (const stmt of this.iffalse)
                buffer += stmt.codegen(prefix + '    ');
        }
        buffer += (`${prefix}}\n`);
        return buffer;
    }
}
Statement.If = IfStmt;

export class Import extends Statement {
    constructor(public what : string) {
        super();
    }

    codegen(prefix = '') : string {
        return `${prefix}await (await $runtime.import(${stringEscape(this.what)}, __dirname))($runtime, $options, $locale, $grammar);\n`;
    }
}
Statement.Import = Import;

interface RuleAttribute {
    name : string;
    code : string;
}

export class RuleAttributes {
    constructor(public attributes : RuleAttribute[] = []) {
    }

    codegen() : string {
        let buf = '{ ';
        buf += this.attributes.map((attr) => `${attr.name}: (${attr.code})`).join(', ');
        buf += ' }';
        return buf;
    }
}

export abstract class Rule {
    static Constants : typeof Constants;
    static Expansion : typeof Expansion;
    static Condition : typeof Condition;
    static Replacement : typeof Replacement;

    abstract codegen(nonTerminal : NonTerminalRef, prefix ?: string) : string;
}

export class Constants extends Rule {
    constructor(public token : string,
                public typeCode : string,
                public attrs : RuleAttributes) {
        super();
    }

    codegen(nonTerminal : NonTerminalRef, prefix = '') : string {
        return `${prefix}$grammar.addConstants(${nonTerminal.codegen()}, ${stringEscape(this.token)}, ${this.typeCode}, ${this.attrs.codegen()});\n`;
    }
}
Rule.Constants = Constants;

function makeBodyLambda(head : RuleHeadPart[],
                        body : string) : string {
    const bodyArgs : string[] = [];
    let i = 0;
    for (const headPart of head) {
        if (headPart instanceof NonTerminalRuleHead && headPart.name)
            bodyArgs.push(headPart.name + ' : any');
        else
            bodyArgs.push(`$${i++}` + ' : any');
    }

    return `(${bodyArgs.join(', ')}) => ${body}`;
}

export class Expansion extends Rule {
    constructor(public head : RuleHeadPart[],
                public bodyCode : string,
                public conditionCode : string|null,
                public attrs : RuleAttributes) {
        super();
        assert(Array.isArray(head));
    }

    codegen(nonTerminal : NonTerminalRef, prefix = '') : string {
        const expanderCode = makeBodyLambda(this.head, this.bodyCode);

        return `${prefix}$grammar.addRule(${nonTerminal.codegen()}, [${this.head.map((h) => h.codegen()).join(', ')}], $runtime.simpleCombine((${expanderCode}), ${this.conditionCode ? stringEscape(this.conditionCode) : 'null'}, ${nonTerminal instanceof IdentifierNTR && nonTerminal.name === '$root'}), ${this.attrs.codegen()});\n`;
    }
}
Rule.Expansion = Expansion;

export class Condition extends Rule {
    constructor(public flag : string,
                public rules : Rule[]) {
        super();
    }

    codegen(nonTerminal : NonTerminalRef, prefix = '') : string {
        const flag = this.flag.startsWith('?') ?
            `$options.flags.${this.flag.substring(1)}` :
            `!$options.flags.${this.flag.substring(1)}`;

        let buffer = '';
        buffer += (`${prefix}if (${flag}) {\n`);
        for (const rule of this.rules)
            buffer += rule.codegen(nonTerminal, prefix + '    ');
        buffer += (`${prefix}}\n`);
        return buffer;
    }
}
Rule.Condition = Condition;

export class Replacement extends Rule {
    constructor(public head : RuleHeadPart[],
                public placeholder : string,
                public bodyCode : string,
                public optionCode : string,
                public attrs : RuleAttributes) {
        super();
    }

    codegen(nonTerminal : NonTerminalRef, prefix = '') : string {
        const expanderCode = makeBodyLambda(this.head, this.bodyCode);

        return (`${prefix}$grammar.addRule(${nonTerminal.codegen()}, [${this.head.map((h) => h.codegen()).join(', ')}], $runtime.combineReplacePlaceholder(${this.placeholder}, (${expanderCode}), ${this.optionCode}), ${this.attrs.codegen()});\n`);
    }
}
Rule.Replacement = Replacement;

export abstract class RuleHeadPart {
    static NonTerminal : typeof NonTerminalRuleHead;
    static StringLiteral : typeof StringLiteralRuleHead;
    static ComputedStringLiteral : typeof ComputedStringLiteralRuleHead;
    static Choice : typeof ChoiceRuleHead;

    abstract codegen() : string;
}

export class NonTerminalRuleHead extends RuleHeadPart {
    constructor(public name : string|null,
                public category : NonTerminalRef) {
        super();
    }

    codegen() : string {
        return `new $runtime.NonTerminal(${this.category.codegen()})`;
    }
}
RuleHeadPart.NonTerminal = NonTerminalRuleHead;

export class StringLiteralRuleHead extends RuleHeadPart {
    constructor(public value : string) {
        super();
    }

    codegen() : string {
        return stringEscape(this.value);
    }
}
RuleHeadPart.StringLiteral = StringLiteralRuleHead;

export class ComputedStringLiteralRuleHead extends RuleHeadPart {
    constructor(public code : string) {
        super();
    }

    codegen() : string {
        return this.code;
    }
}
RuleHeadPart.ComputedStringLiteral = ComputedStringLiteralRuleHead;

export class ChoiceRuleHead extends RuleHeadPart {
    constructor(public values : string[]) {
        super();
    }

    codegen() : string {
        return `new $runtime.Choice([${this.values.map(stringEscape).join(', ')}])`;
    }
}
RuleHeadPart.Choice = ChoiceRuleHead;
