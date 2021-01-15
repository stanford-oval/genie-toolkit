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


import assert from 'assert';
import { stringEscape } from '../../utils/escaping';

export class NodeVisitor {
    visitImport(stmt : Import) {}

    visitContextStmt(stmt : ContextStmt) {}
    visitNonTerminalStmt(stmt : NonTerminalStmt) {}
    visitKeyFunctionDeclaration(stmt : KeyFunctionDeclarationStmt) {}

    visitExpansionRule(stmt : Expansion) {}
    visitConstantsRule(stmt : Constants) {}
    visitConditionRule(stmt : Condition) {}
    visitReplacementRule(stmt : Replacement) {}

    visitNonTerminalRuleHead(node : RuleHeadPart) {}
}

export class Grammar {
    constructor(public comment : string,
                public statements : Statement[]) {
    }

    visit(visitor : NodeVisitor) {
        for (const stmt of this.statements)
            stmt.visit(visitor);
    }

    codegen() : string {
        let buffer = '';

        buffer += (this.comment);
        for (const stmt of this.statements) {
            if (stmt instanceof JSImportStmt)
                buffer += stmt.codegen();
        }
        buffer += `import type { SentenceGeneratorRuntime, SentenceGenerator, I18n } from "genie-toolkit";\n`;
        buffer += `export default async function($runtime : typeof SentenceGeneratorRuntime, $options : any, $locale : I18n.LanguagePack, $grammar : SentenceGenerator<any, any>) : Promise<void> {\n`;
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
    static KeyFunctionDeclaration : typeof KeyFunctionDeclarationStmt;

    abstract codegen(prefix ?: string) : string;
    abstract visit(visitor : NodeVisitor) : void;
}

export class CodeBlock extends Statement {
    constructor(public code : string) {
        super();
    }

    codegen() : string {
        return this.code;
    }

    visit(visitor : NodeVisitor) {}
}
Statement.CodeBlock = CodeBlock;

export class JSImportStmt extends Statement {
    constructor(public code : string) {
        super();
    }

    codegen() : string {
        return `import ${this.code};\n`;
    }

    visit(visitor : NodeVisitor) {}
}
Statement.JSImportStmt = JSImportStmt;

export class KeyFunctionDeclarationStmt extends Statement {
    constructor(public decls : Array<[string, string]>) {
        super();
    }

    codegen() : string {
        return ''; // this is a type declaration processed by the compiler,
                   // it generates no code
    }

    visit(visitor : NodeVisitor) {
        visitor.visitKeyFunctionDeclaration(this);
    }
}
Statement.KeyFunctionDeclaration = KeyFunctionDeclarationStmt;

export class NonTerminalStmt extends Statement {
    keyfn = 'undefined';

    constructor(public name : string,
                public type : string|undefined,
                public rules : Rule[]) {
        super();
    }

    visit(visitor : NodeVisitor) {
        visitor.visitNonTerminalStmt(this);
        for (const rule of this.rules)
            rule.visit(visitor);
    }

    codegen(prefix = '') : string {
        let buffer = '';
        buffer += (`${prefix}$grammar.declareSymbol(${stringEscape(this.name)});\n`);
        for (const rule of this.rules)
            buffer += rule.codegen(this.name, prefix, this.type || 'any', this.keyfn);
        return buffer;
    }
}
Statement.NonTerminal = NonTerminalStmt;

export class ContextStmt extends Statement {
    constructor(public names : string[],
                public type : string|undefined) {
        super();
    }

    visit(visitor : NodeVisitor) {
        visitor.visitContextStmt(this);
    }

    codegen(prefix = '') : string {
        return this.names.map((name) => `${prefix}$grammar.declareContext(${stringEscape(name)});\n`).join('');
    }
}
Statement.Context = ContextStmt;

export class FunctionDeclarationStmt extends Statement {
    constructor(public name : string,
                public args : string,
                public code : string,
                public type = 'any') {
        super();
    }

    visit(visitor : NodeVisitor) {}

    codegen(prefix = '') : string {
        return `${prefix}$grammar.declareFunction('${this.name}', (${this.args}) : ${this.type} => {${this.code}});\n`;
    }
}
Statement.FunctionDeclaration = FunctionDeclarationStmt;

export class ForLoop extends Statement {
    constructor(public head : string,
                public statements : Statement[]) {
        super();
    }

    visit(visitor : NodeVisitor) {
        for (const stmt of this.statements)
            stmt.visit(visitor);
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

    visit(visitor : NodeVisitor) {
        for (const stmt of this.iftrue)
            stmt.visit(visitor);
        for (const stmt of this.iffalse)
            stmt.visit(visitor);
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

    visit(visitor : NodeVisitor) {
        visitor.visitImport(this);
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

    abstract codegen(nonTerminal : string, prefix : string, type : string, keyfn : string) : string;
    abstract visit(visitor : NodeVisitor) : void;
}

export class Constants extends Rule {
    constructor(public token : string,
                public typeCode : string,
                public attrs : RuleAttributes) {
        super();
    }

    visit(visitor : NodeVisitor) {
        visitor.visitConstantsRule(this);
    }

    codegen(nonTerminal : string, prefix = '', type : string, keyfn : string) : string {
        return `${prefix}$grammar.addConstants(${stringEscape(nonTerminal)}, ${stringEscape(this.token)}, ${this.typeCode}, ${keyfn}, ${this.attrs.codegen()});\n`;
    }
}
Rule.Constants = Constants;

function makeBodyLambda(head : RuleHeadPart[],
                        body : string,
                        type = 'any') : string {
    const bodyArgs : string[] = [];
    let i = 0;
    for (const headPart of head) {
        if (headPart instanceof NonTerminalRuleHead && headPart.name)
            bodyArgs.push(headPart.name + ' : ' + headPart.type);
        else
            bodyArgs.push(`$${i++}` + ' : ' + headPart.type);
    }

    return `(${bodyArgs.join(', ')}) : (${type})|null => ${body}`;
}


function getTranslationKey(expansion : RuleHeadPart[]) : [string, string, boolean] {
    let str = '';
    let comment = '';
    let positionalIdx = 0;
    let needsComment = false;

    for (const part of expansion) {
        if (str)
            str += ' ';
        if (comment)
            comment += ' ';
        if (part instanceof StringLiteralRuleHead) {
            str += part.value;
            comment += part.value;
        } else if (part instanceof ComputedStringLiteralRuleHead) {
            str += '${' + String(positionalIdx++) + '}';
            comment += '${' + part.code + '}';
            needsComment = true;
        } else if (part instanceof NonTerminalRuleHead) {
            str += '${' + part.category + '}';
            comment += '${' + part.category + '}';
        } else if (part instanceof ChoiceRuleHead) {
            str += '{' + part.values.join('|') + '}';
            comment += '{' + part.values.join('|') + '}';
        } else {
            throw new TypeError();
        }
    }

    return [str, comment, needsComment];
}

export class Expansion extends Rule {
    constructor(public head : RuleHeadPart[],
                public bodyCode : string,
                public conditionCode : string|null,
                public attrs : RuleAttributes) {
        super();
        assert(Array.isArray(head));
    }

    visit(visitor : NodeVisitor) {
        visitor.visitExpansionRule(this);
        for (const head of this.head)
            head.visit(visitor);
    }

    getTranslationKey() {
        return getTranslationKey(this.head);
    }

    codegen(nonTerminal : string, prefix = '', type : string, keyfn : string) : string {
        const expanderCode = makeBodyLambda(this.head, this.bodyCode, type);

        return `${prefix}$grammar.addRule(${stringEscape(nonTerminal)}, [${this.head.map((h, i) => h.codegen(this.head, i)).join(', ')}], $runtime.simpleCombine((${expanderCode}), ${this.conditionCode ? stringEscape(this.conditionCode) : 'null'}, ${keyfn}), ${this.attrs.codegen()});\n`;
    }
}
Rule.Expansion = Expansion;

export class Condition extends Rule {
    constructor(public flag : string,
                public rules : Rule[]) {
        super();
    }

    visit(visitor : NodeVisitor) {
        visitor.visitConditionRule(this);
        for (const rule of this.rules)
            rule.visit(visitor);
    }

    codegen(nonTerminal : string, prefix : string, type : string, keyfn : string) : string {
        const flag = this.flag.startsWith('?') ?
            `$options.flags.${this.flag.substring(1)}` :
            `!$options.flags.${this.flag.substring(1)}`;

        let buffer = '';
        buffer += (`${prefix}if (${flag}) {\n`);
        for (const rule of this.rules)
            buffer += rule.codegen(nonTerminal, prefix + '    ', type, keyfn);
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

    visit(visitor : NodeVisitor) {
        visitor.visitReplacementRule(this);
        for (const head of this.head)
            head.visit(visitor);
    }

    getTranslationKey() {
        return getTranslationKey(this.head);
    }

    codegen(nonTerminal : string, prefix = '', type : string, keyfn : string) : string {
        const expanderCode = makeBodyLambda(this.head, this.bodyCode, type);

        return (`${prefix}$grammar.addRule(${stringEscape(nonTerminal)}, [${this.head.map((h, i) => h.codegen(this.head, i)).join(', ')}], $runtime.combineReplacePlaceholder(${this.placeholder}, (${expanderCode}), ${this.optionCode}, ${keyfn}), ${this.attrs.codegen()});\n`);
    }
}
Rule.Replacement = Replacement;

export abstract class NonTerminalConstraint {
    static Constant : typeof ConstantNonTerminalConstraint;
    static Equality : typeof EqualityNonTerminalConstraint;

    abstract codegen(allParts : RuleHeadPart[], ourKeyFn : string, ourIndex : number) : string;
}

export class EqualityNonTerminalConstraint extends NonTerminalConstraint {
    constructor(public ourIndexName : string,
                public nonTermRef : string,
                public theirIndexName : string) {
        super();
    }

    codegen(allParts : RuleHeadPart[], ourKeyFn : string, ourIndex : number) {
        if (ourKeyFn === 'undefined')
            console.error(`WARNING: key function is not set in constraint {${this.ourIndexName} = ${this.nonTermRef}.${this.theirIndexName}}, cannot check correctness statically`);
        const ourTypeConstraint = ourKeyFn === 'undefined' ? '' :
            ` as (${stringEscape(this.ourIndexName)} extends keyof ReturnType<typeof ${ourKeyFn}> ? string : void)`;

        let nonTermIndex, theirKeyFn;
        if (/^[0-9]+/.test(this.nonTermRef)) {
            nonTermIndex = parseInt(this.nonTermRef, 10);
            assert(allParts[nonTermIndex]);

            theirKeyFn = allParts[nonTermIndex];
        } else {
            for (let i = 0; i < allParts.length; i++) {
                const part = allParts[i];
                if (part instanceof NonTerminalRuleHead &&
                    part.name === this.nonTermRef) {
                    nonTermIndex = i;
                    theirKeyFn = part.keyfn;
                    break;
                }
            }
            if (nonTermIndex === undefined)
                throw new Error(`Invalid non-terminal backreference to ${this.nonTermRef} for equality constraint of ${allParts[ourIndex]} (alias not found)`);
            if (nonTermIndex >= ourIndex)
                throw new Error(`Invalid non-terminal backreference to ${this.nonTermRef} for equality constraint of ${allParts[ourIndex]} (alias must precede usage)`);
        }
        if (theirKeyFn === 'undefined')
            console.error(`WARNING: key function is not set in constraint {${this.ourIndexName} = ${this.nonTermRef}.${this.theirIndexName}}, cannot check correctness statically`);
        const theirTypeConstraint = theirKeyFn === 'undefined' ? '' :
            ` as (${stringEscape(this.theirIndexName)} extends keyof ReturnType<typeof ${theirKeyFn}> ? string : void)`;

        return `[${stringEscape(this.ourIndexName)}${ourTypeConstraint}, ${nonTermIndex}, ${stringEscape(this.theirIndexName)}${theirTypeConstraint}]`;
    }
}
NonTerminalConstraint.Equality = EqualityNonTerminalConstraint;

export class ConstantNonTerminalConstraint extends NonTerminalConstraint {
    constructor(public indexName : string,
                public valueCode : string) {
        super();
    }

    codegen(allParts : RuleHeadPart[], ourKeyFn : string) {
        if (ourKeyFn === 'undefined')
            console.error(`WARNING: key function is not set in constraint {${this.indexName} = ${this.valueCode}}, cannot check correctness statically`);
        const ourTypeConstraint = ourKeyFn === 'undefined' ? '' :
            ` as (${stringEscape(this.indexName)} extends keyof ReturnType<typeof ${ourKeyFn}> ? string : void)`;
        const constantTypeConstraint = ourKeyFn === 'undefined' ? '' :
            ` as ReturnType<typeof ${ourKeyFn}>[${stringEscape(this.indexName)}]`;

        return `[${stringEscape(this.indexName)}${ourTypeConstraint}, (${this.valueCode})${constantTypeConstraint}]`;
    }
}
NonTerminalConstraint.Constant = ConstantNonTerminalConstraint;

export abstract class RuleHeadPart {
    static NonTerminal : typeof NonTerminalRuleHead;
    static StringLiteral : typeof StringLiteralRuleHead;
    static ComputedStringLiteral : typeof ComputedStringLiteralRuleHead;
    static Choice : typeof ChoiceRuleHead;

    abstract type : string;
    abstract codegen(allParts : RuleHeadPart[], index : number) : string;
    abstract visit(visitor : NodeVisitor) : void;
}

export class NonTerminalRuleHead extends RuleHeadPart {
    type = 'any';
    keyfn = 'undefined';

    constructor(public name : string|null,
                public category : string,
                public constraint : NonTerminalConstraint|null) {
        super();
    }

    toString() {
        return `${this.name} : NT[${this.category}]`;
    }

    visit(visitor : NodeVisitor) {
        visitor.visitNonTerminalRuleHead(this);
    }

    codegen(allParts : RuleHeadPart[], index : number) : string {
        return `new $runtime.NonTerminal(${stringEscape(this.category)}, ${this.constraint ? this.constraint.codegen(allParts, this.keyfn, index) : 'undefined'})`;
    }
}
RuleHeadPart.NonTerminal = NonTerminalRuleHead;

export class StringLiteralRuleHead extends RuleHeadPart {
    type = 'undefined';

    constructor(public value : string) {
        super();
    }

    visit(visitor : NodeVisitor) {}

    codegen() : string {
        return stringEscape(this.value);
    }
}
RuleHeadPart.StringLiteral = StringLiteralRuleHead;

export class ComputedStringLiteralRuleHead extends RuleHeadPart {
    type = 'undefined';

    constructor(public code : string) {
        super();
    }

    visit(visitor : NodeVisitor) {}

    codegen() : string {
        return this.code;
    }
}
RuleHeadPart.ComputedStringLiteral = ComputedStringLiteralRuleHead;

export class ChoiceRuleHead extends RuleHeadPart {
    type = 'undefined';

    constructor(public values : string[]) {
        super();
    }

    visit(visitor : NodeVisitor) {}

    codegen() : string {
        return `new $runtime.Choice([${this.values.map(stringEscape).join(', ')}])`;
    }
}
RuleHeadPart.Choice = ChoiceRuleHead;
