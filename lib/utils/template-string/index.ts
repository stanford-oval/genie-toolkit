// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie.
//
// Copyright 2019-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as I18n from '../../i18n';
import { uniform, coin } from '../../utils/random';

import * as TemplateGrammar from './grammar';

/**
 * Natural language template language that supports grammar-based constraints
 * to handle agreement in number, tense, gender, etc.
 *
 */

type FlagValue = string|number;

/**
 * The result of replacing placeholders in a template.
 *
 * This is a tree of strings or choices, each associated with flags.
 */
export abstract class ReplacedResult {
    static EMPTY : ReplacedResult;

    /**
     * Apply a flag constraint to this tree.
     *
     * Returns a constrained tree, or null if no possible set of choices
     * is valid.
     *
     */
    abstract constrain(flag : string, value : FlagValue) : ReplacedResult|null;

    abstract chooseSample(rng : () => number) : string;
    abstract chooseBest() : string;
}

class EmptyReplacement extends ReplacedResult {
    constrain(flag : string, value : FlagValue) {
        return this;
    }

    chooseSample(rng : () => number) {
        return '';
    }

    chooseBest() {
        return '';
    }
}
ReplacedResult.EMPTY = new EmptyReplacement();

function whitespaceJoin(iterable : Iterable<unknown>, joiner = '') {
    joiner = joiner.trim();
    let buf = '';
    for (const element of iterable) {
        const string = (typeof element === 'string' ? element : String(element)).trim();
        if (!string)
            continue;
        if (buf) {
            buf += ' ';
            if (joiner) {
                buf += joiner;
                buf += ' ';
            }
        }
        buf += string;
    }
    return buf;
}

export class ReplacedConcatenation extends ReplacedResult {
    constructor(public text : Array<string|ReplacedResult>,
                public constFlags : Record<string, FlagValue>,
                public refFlags : Record<string, [number, string]>) {
        super();
    }

    toString() {
        const buf = this.text.map((t) => '{' + t + '}').join(' ');

        const flags = [];
        for (const flag in this.constFlags)
            flags.push(`${flag}=${this.constFlags[flag]}`);
        for (const flag in this.refFlags)
            flags.push(`${flag}=${this.refFlags[flag][0]}[${this.refFlags[flag][1]}]`);
        if (flags.length > 0)
            return buf + ` [${flags.join(',')}]`;
        else
            return buf;
    }

    constrain(flag : string, value : FlagValue) : ReplacedResult|null {
        if (flag in this.constFlags) {
            const ourValue = this.constFlags[flag];
            if (ourValue === value)
                return this;
            else
                return null;
        }

        if (flag in this.refFlags) {
            const [index, subflag] = this.refFlags[flag];
            const constrained = (this.text[index] as ReplacedResult).constrain(subflag, value);
            if (constrained === null)
                return null;

            const newText = this.text.slice(0, index);
            newText.push(constrained);
            newText.push(...this.text.slice(index+1));

            const newFlags : Record<string, FlagValue> = {};
            Object.assign(newFlags, this.constFlags);
            newFlags[flag] = value;

            const newRefFlags : Record<string, [number, string]> = {};
            Object.assign(newRefFlags, this.refFlags);
            delete newRefFlags[flag];
            return new ReplacedConcatenation(newText, newFlags, newRefFlags);
        }

        // no constraint at all
        return this;
    }

    chooseSample(rng : () => number) {
        const text = this.text.map((t) => typeof t === 'string' ? t : t.chooseSample(rng));
        return whitespaceJoin(text);
    }

    chooseBest() {
        const text = this.text.map((t) => typeof t === 'string' ? t : t.chooseBest());
        return whitespaceJoin(text);
    }
}

export class ReplacedChoice extends ReplacedResult {
    constructor(public choices : ReplacedResult[]) {
        super();
    }

    toString() {
        return `{${this.choices.join('|')}}`;
    }

    constrain(flag : string, value : FlagValue) : ReplacedResult|null {
        const constrained = this.choices.map((c) => c.constrain(flag, value))
            .filter((x) : x is ReplacedResult => x !== null);
        if (constrained.length === 0)
            return null;
        if (constrained.length === 1)
            return constrained[0];
        return new ReplacedChoice(constrained);
    }

    chooseSample(rng : () => number) {
        return uniform(this.choices, rng).chooseSample(rng);
    }

    chooseBest() {
        return this.choices[0].chooseBest();
    }
}

type ListFormatPart = {
    type : 'literal',
    value : string
} | {
    type : 'element',
    value : string
};

export class ReplacedList extends ReplacedResult {
    constructor(public elements : ReplacedResult[],
                public locale : string,
                public listType : string|undefined) {
        super();
    }

    get length() {
        return this.elements.length;
    }

    private _makeList(elements : unknown[], listType : string) : string {
        if (listType === 'disjunction' ||
            listType === 'conjunction') {
            const strings = elements.map((el) => String(el));
            const formatted = new (Intl as any).ListFormat(this.locale, { type: listType })
                .formatToParts(strings);
            return whitespaceJoin(formatted.map((el : ListFormatPart) => el.type === 'literal' ? el.value.trim() : el.value));
        }
        return whitespaceJoin(elements, this.listType);
    }

    toString() {
        return this._makeList(this.elements, 'conjunction');
    }

    constrain(flag : string, value : FlagValue) : ReplacedResult|null {
        const mapped : ReplacedResult[] = [];
        for (const el of this.elements) {
            const constrained = el.constrain(flag, value);
            if (constrained === null)
                return null;
            mapped.push(el);
        }
        if (flag === 'list_type') {
            if (this.listType === undefined)
                return new ReplacedList(mapped, this.locale, String(value));
            else if (this.listType !== value)
                return null;
        }
        return new ReplacedList(mapped, this.locale, this.listType);
    }

    chooseSample(rng : () => number) {
        const listType = this.listType === undefined ?
            (coin(0.5, rng) ? 'conjunction' : 'disjunction') : this.listType;
        return this._makeList(this.elements.map((el) => el.chooseSample(rng)), listType);
    }

    chooseBest() {
        return this._makeList(this.elements.map((el) => el.chooseBest()),
            this.listType ?? 'conjunction');
    }
}

/**
 * An object that represents the value with which to replace a placeholder.
 */
export interface PlaceholderReplacement {
    value : any;
    text : ReplacedResult;
}

type PlaceholderConstraints = Record<number, Record<string, FlagValue>>;

// AST objects (representations of a parsed template)


interface ReplacementContext {
    replacements : Record<number, PlaceholderReplacement>;
    constraints : PlaceholderConstraints;
}

export abstract class Replaceable {
    private static _cache = new Map<string, Replaceable>();

    /**
     * Parse a template string into a replaceable object.
     */
    static parse(template : string) : Replaceable {
        return TemplateGrammar.parse(template);
    }

    /**
     * Parse a template string into a replaceable object, and preprocess
     * it immediately.
     *
     * This method differs from {@link Replaceable.parse} because it will
     * cache the result so it is fast to call multiple times for the same string.
     */
    static get(template : string, locale : string, names : string[]) {
        const cacheKey = locale + '/' + template;
        const cached = Replaceable._cache.get(cacheKey);
        if (cached)
            return cached;

        const parsed = TemplateGrammar.parse(template);
        parsed.preprocess(locale, names);
        Replaceable._cache.set(cacheKey, parsed);
        return parsed;
    }

    abstract visit(cb : (repl : Replaceable) => boolean) : void;

    abstract preprocess(locale : string, placeholders : string[]) : this;

    abstract replace(ctx : ReplacementContext) : ReplacedResult|null;
}


/**
 * A named placeholder.
 *
 * A placeholder can be followed by an option. The meaning of the option is not
 * defined at this level.
 */
export class Placeholder extends Replaceable {
    private _index : number|undefined = undefined;

    constructor(public param : string,
                public key : string[] = [],
                public option : string = '') {
        super();
    }

    toString() {
        return `\${${this.param}${this.key.length > 0 ? '.' + this.key.join('.') : ''}`
            + (this.option ? `:${this.option}` : '') + '}';
    }

    visit(cb : (repl : Replaceable) => boolean) {
        cb(this);
    }

    preprocess(locale : string, placeholders : string[]) {
        this._index = getPlaceholderIndex(placeholders, this.param);
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        const param = ctx.replacements[this._index!];
        if (!param)
            return null;

        if (this.key.length > 0) {
            const replacement = get(param.value, this.key);
            if (replacement === null || replacement === undefined)
                return null;
            return new ReplacedConcatenation([String(replacement)], {}, {});
        } else {
            let replacement = param.text;
            const paramConstraints = ctx.constraints[this._index!] || {};
            for (const flag in paramConstraints) {
                const value = paramConstraints[flag];
                const maybeReplacement = replacement.constrain(flag, value);
                if (maybeReplacement === null)
                    return null;
                replacement = maybeReplacement;
            }

            return replacement;
        }
    }
}

function templateEscape(str : string) {
    return str.replace(/[${}|[\]\\]/g, '\\$0');
}

/**
 * A piece of text with flags such as gender, number, tense, etc.
 *
 * In syntax, they are represented by free text followed by `[flag=value]`.
 * Examples:
 *
 * `actor [gender=masculine]`
 * `restaurants [plural=other]`
 */
export class Phrase extends Replaceable {
    constructor(public text : string,
                public flags : Record<string, string> = {}) {
        super();
    }

    clone() {
        const flags : Record<string, string> = {};
        Object.assign(flags, this.flags);
        return new Phrase(this.text, flags);
    }

    toString() {
        const text = templateEscape(this.text);

        const flags = [];
        for (const flag in this.flags)
            flags.push(`${flag}=${this.flags[flag]}`);
        if (flags.length > 0)
            return `${text} [${flags.join(',')}]`;
        else
            return text;
    }

    toReplaced() {
        return new ReplacedConcatenation([this.text], this.flags, {});
    }

    visit(cb : (repl : Replaceable) => boolean) {
        cb(this);
    }

    preprocess(locale : string, placeholders : string[]) {
        const tokenizer = I18n.get(locale).getTokenizer();
        this.text = tokenizer.tokenize(this.text).rawTokens.join(' ');
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        return new ReplacedConcatenation([this.text], this.flags, {});
    }
}

function mergeConstraints(into : PlaceholderConstraints, newConstraints : PlaceholderConstraints) {
    for (const placeholder in newConstraints) {
        if (!(placeholder in into))
            into[placeholder] = {};
        for (const flag in newConstraints[placeholder])
            into[placeholder][flag] = newConstraints[placeholder][flag];
    }
}

/**
 * Concatenation of multiple replaceable elements.
 *
 * The concatenation does not propagate the flags of the elements, but
 * it has its own set of flags.
 */
export class Concatenation extends Replaceable {
    private _computedRefFlags : Record<string, [number, string]> = {};
    private _hasAnyFlag : boolean;

    constructor(public children : Replaceable[],
                public flags : Record<string, FlagValue>,
                public refFlags : Record<string, [string|number, string]>) {
        super();

        this._hasAnyFlag = Object.keys(flags).length + Object.keys(refFlags).length > 0;
    }

    toString() {
        const buf = this.children.join(' ');

        const flags = [];
        for (const flag in this.flags)
            flags.push(`${flag}=${this.flags[flag]}`);
        for (const flag in this.refFlags)
            flags.push(`${flag}=${this.refFlags[flag][0]}[${this.refFlags[flag][1]}]`);
        if (flags.length > 0)
            return buf + ` [${flags.join(',')}]`;
        else
            return buf;
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const c of this.children)
            c.visit(cb);
    }

    preprocess(locale : string, placeholders : string[]) {
        for (const c of this.children)
            c.preprocess(locale, placeholders);

        for (const ourFlag in this.refFlags) {
            const [placeholder, theirFlag] = this.refFlags[ourFlag];

            if (typeof placeholder === 'number') {
                if (placeholder < 0 || placeholder >= this.children.length)
                    throw new Error(`Invalid ref-flag [${ourFlag}=${placeholder}[${theirFlag}]]`);
                this._computedRefFlags[ourFlag] = [placeholder, theirFlag];
            } else {
                let found = -1;
                for (let i = 0; i < this.children.length; i++) {
                    const c = this.children[i];
                    if (c instanceof Placeholder && c.param === placeholder) {
                        found = i;
                        break;
                    }
                }
                if (found < 0)
                    throw new Error(`Invalid ref-flag [${ourFlag}=${placeholder}[${theirFlag}]], must refer to a placeholder immediately used in the same concatenation expression`);
                this._computedRefFlags[ourFlag] = [found, theirFlag];
            }
        }

        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        const replaced : Array<string|ReplacedResult> = [];
        for (const child of this.children) {
            const childReplacement = child.replace(ctx);
            if (childReplacement === null)
                return null;

            // if we don't have any flags, we can flatten the replacement
            // if we do have flags, we cannot because it will change the meaning of the ref flags
            if (!this._hasAnyFlag && childReplacement instanceof ReplacedConcatenation)
                replaced.push(...childReplacement.text);
            else
                replaced.push(childReplacement);
        }

        return new ReplacedConcatenation(replaced, this.flags, this._computedRefFlags);
    }
}

/**
 * A phrase that has multiple equivalent variants.
 *
 * Different variants can set different flags, to account for gender,
 * plural, case, tense, mood, etc.
 */
export class Choice implements Replaceable {
    constructor(public variants : Replaceable[]) {
    }

    toString() {
        return `{${this.variants.join('|')}}`;
    }

    preprocess(locale : string, placeholders : string[]) {
        for (const v of this.variants)
            v.preprocess(locale, placeholders);
        return this;
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const v of this.variants)
            v.visit(cb);
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        const variants : ReplacedResult[] = [];
        for (const v of this.variants) {
            const replaced = v.replace(ctx);
            if (replaced === null)
                continue;
            variants.push(replaced);
        }
        if (variants.length === 0)
            return null;
        else if (variants.length === 1)
            return variants[0];
        else
            return new ReplacedChoice(variants);
    }
}

function get(value : any, keys : string[]) : unknown {
    for (const key of keys) {
        value = value[key];
        if (value === null || value === undefined)
            return value;
    }
    return value;
}

function getPlaceholderIndex(placeholders : string[], toFind : string) {
    const index = placeholders.indexOf(toFind);
    if (index < 0)
        throw new TypeError(`Invalid placeholder \${${toFind}}, allowed placeholders are: ${placeholders.join(', ')}`);
    return index;
}

/**
 * A phrase that depends on a numeric value.
 *
 * The syntax is:
 * ```
 * ${param.key:plural:
 *    pluralname{variant}
 *    ...
 * }
 * ```
 *
 * Example:
 * ```
 * ${results.length:plural:
 *    one{restaurant}
 *    other{restaurants}
 * }
 */
export class Plural implements Replaceable {
    private _index : number|undefined = undefined;
    private _rules : Intl.PluralRules|undefined = undefined;

    constructor(public param : string,
                public key : string[],
                public type : Intl.PluralRuleType,
                public variants : Record<string|number, Replaceable>) {
    }

    toString() {
        let buf = `\${${this.param}${this.key.length > 0 ? '.' + this.key.join('.') : ''}:${this.type === 'cardinal' ? 'plural' : this.type}:`;
        for (const variant in this.variants)
            buf += `${typeof variant === 'number' ? '=' + variant : variant}{${this.variants[variant]}}`;
        buf += `}`;
        return buf;
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const v in this.variants)
            this.variants[v].visit(cb);
    }

    preprocess(locale : string, placeholders : string[]) {
        for (const v in this.variants)
            this.variants[v].preprocess(locale, placeholders);

        this._index = getPlaceholderIndex(placeholders, this.param);

        this._rules = new Intl.PluralRules(locale, { type: this.type });
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        const param = ctx.replacements[this._index!];
        if (!param)
            return null;

        const value = get(param.value, this.key);
        if (value === null || value === undefined)
            return null;

        const number = Number(value);
        if (number in this.variants)
            return this.variants[number].replace(ctx);

        const variant = this._rules!.select(number);
        if (variant in this.variants)
            return this.variants[variant].replace(ctx);
        else
            return null;
    }
}

/**
 * A phrase that depends on an enumerated value.
 *
 * The syntax is:
 * ```
 * ${param.key:select:
 *    v1{variant}
 *    v2{variant}
 *    ...
 * }
 * ```
 *
 * Example:
 *
 * ```
 * ${status.value:select:
 *    sunny{The sun is shining}
 *    cloudy{The sun is covered by clouds}
 * }
 * ```
 */
export class ValueSelect implements Replaceable {
    private _index : number|undefined = undefined;

    constructor(public param : string,
                public key : string[],
                public variants : Record<string, Replaceable>) {
    }

    toString() {
        let buf = `\${${this.param}${this.key.length > 0 ? '.' + this.key.join('.') : ''}:select:`;
        for (const variant in this.variants)
            buf += `${variant}{${this.variants[variant]}}`;
        buf += `}`;
        return buf;
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const v in this.variants)
            this.variants[v].visit(cb);
    }

    preprocess(locale : string, placeholders : string[]) {
        for (const v in this.variants)
            this.variants[v].preprocess(locale, placeholders);

        this._index = getPlaceholderIndex(placeholders, this.param);
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        const param = ctx.replacements[this._index!];
        if (!param)
            return null;

        const value = String(get(param.value, this.key));
        if (value in this.variants)
            return this.variants[value].replace(ctx);
        else if ('_' in this.variants)
            return this.variants['_'].replace(ctx);
        else
            return null;
    }
}

/**
 * A phrase that depends on a flag.
 *
 * The syntax is:
 * ```
 * ${param[key]:select:
 *    v1{variant}
 *    v2{variant}
 *    ...
 * }
 * ```
 * (which depends on a flag of the parameter)
 *
 * Example:
 *
 * ```
 * ${table[gender]:select:
 *    masculine{his}
 *    feminine{her}
 * }
 * ```
 */
export class FlagSelect implements Replaceable {
    private _index : number|undefined = undefined;

    constructor(public param : string,
                public flag : string,
                public variants : Record<string, Replaceable>) {
    }

    toString() {
        let buf = `\${${this.param}[${this.flag}]:select:`;
        for (const variant in this.variants)
            buf += `${variant}{${this.variants[variant]}}`;
        buf += `}`;
        return buf;
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const v in this.variants)
            this.variants[v].visit(cb);
    }

    preprocess(locale : string, placeholders : string[]) {
        for (const v in this.variants)
            this.variants[v].preprocess(locale, placeholders);
        this._index = getPlaceholderIndex(placeholders, this.param);
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        // check if we already have a constraint on this param
        if (ctx.constraints[this._index!] && this.flag in ctx.constraints[this._index!]) {
            const constraint = ctx.constraints[this._index!][this.flag];
            if (!this.variants[constraint])
                return null;

            return this.variants[constraint].replace(ctx);
        }

        const variants : ReplacedResult[] = [];
        for (const v in this.variants) {
            // make a new replacement context with the added constraint on this
            // placeholder
            // the constraint will be propagated down to where this placeholder is
            // used, and will be applied to the replacement of the placeholder
            const newCtx : ReplacementContext = {
                replacements: ctx.replacements,
                constraints: {}
            };
            mergeConstraints(newCtx.constraints, ctx.constraints);
            mergeConstraints(newCtx.constraints, { [this._index!]: { [this.flag]: v } });

            const replaced = this.variants[v].replace(newCtx);
            if (replaced === null)
                continue;
            variants.push(replaced);
        }
        if (variants.length === 0)
            return null;
        else if (variants.length === 1)
            return variants[0];
        else
            return new ReplacedChoice(variants);
    }
}
