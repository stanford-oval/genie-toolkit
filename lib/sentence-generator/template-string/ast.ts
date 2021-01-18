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
import { uniform } from '../../utils/random';

/**
 * Natural language template language that supports grammar-based constraints
 * to handle agreement in number, tense, gender, etc.
 *
 * @module
 */

type FlagValue = string|number;

/**
 * The result of replacing placeholders in a template.
 *
 * This is a tree of strings or choices, each associated with flags.
 */
export interface ReplacedResult {
    /**
     * Apply a flag constraint to this tree.
     *
     * Returns a constrained tree, or null if no possible set of choices
     * is valid.
     *
     */
    constrain(flag : string, value : FlagValue) : ReplacedResult|null;

    chooseSample(rng : () => number) : string;
    chooseBest() : string;
}

class ReplacedConcatenation implements ReplacedResult {
    constructor(public text : Array<string|ReplacedResult>,
                public constFlags : Record<string, FlagValue>,
                public refFlags : Record<string, [number, string]>) {
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
            return new ReplacedConcatenation(newText, newFlags, this.refFlags);
        }

        // no constraint at all
        return this;
    }

    chooseSample(rng : () => number) {
        const text = this.text.map((t) => typeof t === 'string' ? t : t.chooseSample(rng));
        return text.join(' ');
    }

    chooseBest() {
        const text = this.text.map((t) => typeof t === 'string' ? t : t.chooseBest());
        return text.join(' ');
    }
}

class ReplacedChoice implements ReplacedResult {
    constructor(public choices : ReplacedResult[]) {
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

/**
 * An object that represents the value with which to replace a placeholder.
 */
export interface PlaceholderReplacement {
    value : any;
    text : ReplacedResult;
}

type PlaceholderConstraints = Record<string, Record<string, FlagValue>>;

// AST objects (representations of a parsed template)


interface ReplacementContext {
    replacements : Record<string, PlaceholderReplacement>;
    constraints : PlaceholderConstraints;
}

abstract class Replaceable {
    abstract visit(cb : (repl : Replaceable) => boolean) : void;

    abstract preprocess(locale : string) : this;

    abstract replace(ctx : ReplacementContext) : ReplacedResult|null;
}


/**
 * A named placeholder.
 *
 * A placeholder can be followed by an option. The meaning of the option is not
 * defined at this level.
 */
export class Placeholder extends Replaceable {
    constructor(public param : string,
                public key : string[],
                public option : string = '') {
        super();
    }

    visit(cb : (repl : Replaceable) => boolean) {
        cb(this);
    }

    preprocess(locale : string) {
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        const param = ctx.replacements[this.param];
        if (!param)
            return null;

        if (this.key.length > 0) {
            const replacement = get(param.value, this.key);
            if (replacement === null || replacement === undefined)
                return null;
            return new ReplacedConcatenation([String(replacement)], {}, {});
        } else {
            let replacement = param.text;
            const paramConstraints = ctx.constraints[this.param] || {};
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
                public flags : Record<string, string>) {
        super();
    }

    visit(cb : (repl : Replaceable) => boolean) {
        cb(this);
    }

    preprocess(locale : string) {
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

    constructor(public children : Replaceable[],
                public constFlags : Record<string, FlagValue>,
                public refFlags : Record<string, [string|number, string]>) {
        super();
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const c of this.children)
            c.visit(cb);
    }

    preprocess(locale : string) {
        for (const c of this.children)
            c.preprocess(locale);

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
        const replaced : ReplacedResult[] = [];
        for (const child of this.children) {
            const childReplacement = child.replace(ctx);
            if (childReplacement === null)
                return null;
            replaced.push(childReplacement);
        }

        return new ReplacedConcatenation(replaced, this.constFlags, this._computedRefFlags);
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

    preprocess(locale : string) {
        for (const v of this.variants)
            v.preprocess(locale);
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
    private _rules : Intl.PluralRules|undefined = undefined;

    constructor(public param : string,
                public key : string[],
                public type : Intl.PluralRuleType,
                public variants : Record<string|number, Replaceable>) {
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const v in this.variants)
            this.variants[v].visit(cb);
    }

    preprocess(locale : string) {
        for (const v in this.variants)
            this.variants[v].preprocess(locale);

        this._rules = new Intl.PluralRules(locale, { type: this.type });
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        const param = ctx.replacements[this.param];
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
    constructor(public param : string,
                public key : string[],
                public variants : Record<string, Replaceable>) {
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const v in this.variants)
            this.variants[v].visit(cb);
    }

    preprocess(locale : string) {
        for (const v in this.variants)
            this.variants[v].preprocess(locale);
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        const param = ctx.replacements[this.param];
        if (!param)
            return null;

        const value = String(get(param.value, this.key));
        if (value in this.variants)
            return this.variants[value].replace(ctx);
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
    constructor(public param : string,
                public flag : string,
                public variants : Record<string, Replaceable>) {
    }

    visit(cb : (repl : Replaceable) => boolean) {
        if (!cb(this))
            return;
        for (const v in this.variants)
            this.variants[v].visit(cb);
    }

    preprocess(locale : string) {
        for (const v in this.variants)
            this.variants[v].preprocess(locale);
        return this;
    }

    replace(ctx : ReplacementContext) : ReplacedResult|null {
        // check if we already have a constraint on this param
        if (ctx.constraints[this.param] && this.flag in ctx.constraints[this.param]) {
            const constraint = ctx.constraints[this.param][this.flag];
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
            mergeConstraints(newCtx.constraints, { [this.param]: { [this.flag]: v } });

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
