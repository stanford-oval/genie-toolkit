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


import assert from 'assert';

import List from './list';
import { uniform } from '../utils/random';

export { importGenie as import } from './compiler';

const LogLevel = {
    NONE: 0,

    // log at the beginning and at the end of the generation for each depth, and notable events
    // such as particularly slow templates
    INFO: 1,

    // log each non-empty non terminal
    GENERATION: 2,

    // log all templates before generation
    DUMP_TEMPLATES: 3,

    // log information derived from the templates (such as the distance from the root)
    DUMP_DERIVED: 4,

    // log a lot of very redundant information during generation (can cause slowdowns)
    EVERYTHING: 5
};

class Placeholder {
    constructor(public symbol : string,
                public option ?: ('const' | 'no-undefined')) {
        assert(!option || option === 'const' || option === 'no-undefined');
    }

    toString() : string {
        return '${' + this.symbol + '}'; //'
    }
}

/**
 * A reference to a context.
 *
 * A context is an object that is passed as extra input to a semantic function
 * to affect its behavior. Grammar rules are only applied between identical (===) contexts.
 *
 * The "context" in this definition roughly corresponds to a dialogue context
 * (either a C: state, or a more general notion) but it need not be.
 *
 * "priv" is a value associated with the context that is only meaningful to the API caller
 * (DialogueGenerator). "info" is a value associated with the context that is meaningful
 * to the semantic function.
 * See {@link Grammar#_initializeContexts} for a longer explanation.
 */
class Context {
    constructor(public priv : unknown,
                public info : unknown) {
    }

    toString() : string {
        return `CTX[${this.info}]`;
    }

    static compatible(c1 : Context|null, c2 : Context|null) : boolean {
        return c1 === null || c2 === null || c1 === c2;
    }
    static meet(c1 : Context|null, c2 : Context|null) : Context|null {
        if (c1 === null)
            return c2;
        else
            return c1;
    }
}

export type DerivationChild<T> = string | Context | Placeholder | Derivation<T>;

export type SemanticAction<ArgType extends unknown[], ReturnType> = (...args : ArgType) => ReturnType|null;

export type DerivationChildTuple<ArgTypes extends unknown[]> = { [K in keyof ArgTypes] : DerivationChild<ArgTypes[K]> };

export interface CombinerAction<ArgTypes extends unknown[], ReturnType> {
    (children : DerivationChildTuple<ArgTypes>, rulePriority : number) : Derivation<ReturnType>|null;
    isReplacePlaceholder ?: boolean;
}

interface ReplacePlaceholderOptions {
    isConstant ?: boolean;
    isUndefined ?: boolean;
    throwIfMissing ?: boolean;
}


// A Derivation represents a sentence, possibly with placeholders,
// and a value, possibly with unspecified input parameters, that
// was computed at a certain point in the derivation tree
class Derivation<ValueType> {
    value : ValueType;
    context : Context|null;
    sentence : List<DerivationChild<unknown>>;
    priority : number;

    private _flatSentence : string|null;
    private _hasPlaceholders : boolean|undefined;

    constructor(value : ValueType,
                sentence : List<DerivationChild<unknown>>,
                context : Context|null = null,
                priority = 0) {
        this.value = value;
        if (value === undefined)
            throw new TypeError('Invalid value');
        this.context = context;
        assert(typeof this.context === 'object'); // incl. null
        this.sentence = sentence;
        this.priority = priority;
        assert(Number.isFinite(this.priority));
        assert(sentence instanceof List);

        this._flatSentence = null;
        this._hasPlaceholders = undefined;
    }

    hasPlaceholders() : boolean {
        if (this._hasPlaceholders !== undefined)
            return this._hasPlaceholders;

        let hasPlaceholders = false;
        this.sentence.traverse((child : DerivationChild<unknown>) => {
            hasPlaceholders = hasPlaceholders || child instanceof Placeholder;
        });
        return this._hasPlaceholders = hasPlaceholders;
    }

    hasPlaceholder(what : string) : boolean {
        let hasPlaceholder = false;
        this.sentence.traverse((child : DerivationChild<unknown>) => {
            hasPlaceholder = hasPlaceholder || (child instanceof Placeholder && child.symbol === what);
        });
        return hasPlaceholder;
    }

    get complete() : boolean {
        const v = !this.hasPlaceholders();
        return v;
    }

    toString() : string {
        if (this._flatSentence)
            return this._flatSentence;

        const flattened : string[] = [];
        this.sentence.traverse((el : DerivationChild<unknown>) => flattened.push(String(el)));
        return this._flatSentence = flattened.join(' ');
    }

    clone() : Derivation<ValueType> {
        return new Derivation(this.value, this.sentence, this.context, this.priority);
    }

    replacePlaceholder<OtherArgType, ResultType>(name : string,
                                                 replacement : Derivation<OtherArgType>|string,
                                                 semanticAction : SemanticAction<[ValueType, OtherArgType], ResultType>,
                                                 { isConstant, isUndefined = false, throwIfMissing = false } : ReplacePlaceholderOptions,
                                                 rulePriority : number) : Derivation<ResultType>|null {
        let newValue;
        let isDerivation : boolean;
        if (!(replacement instanceof Derivation)) {
            newValue = semanticAction(this.value, undefined as unknown as OtherArgType);
            isDerivation = false;
        } else {
            assert(Context.compatible(this.context, replacement.context));
            newValue = semanticAction(this.value, replacement.value);
            isDerivation = true;
        }
        assert(newValue !== undefined);

        if (newValue === null) {
            /*if (!derivation.value.isVarRef || !derivation.value.name.startsWith('__const'))
                return null;*/
            /*if (throwIfMissing && this.hasPlaceholder(name)) {
                console.log('replace ' + name + ' in ' + this + ' with ' + derivation);
                console.log('values: ' + [this.value, derivation.value].join(' , '));
                throw new TypeError('???');
            }*/
            return null;
        }

        let newSentence : List<DerivationChild<unknown>> = List.Nil;
        let newContext = this.context;
        let newPriority = this.priority + rulePriority;
        let found = false;
        let bad = false;
        this.sentence.traverse((child : DerivationChild<unknown>) => {
            if (child instanceof Placeholder && child.symbol === name) {
                if (child.option === 'no-undefined' && isUndefined)
                    bad = true;
                if (child.option === 'const' && !isConstant && !isUndefined)
                    bad = true;
                if (isDerivation) {
                    const deriv = replacement as Derivation<OtherArgType>;
                    newSentence = List.concat(newSentence, deriv.sentence);
                    newContext = Context.meet(newContext, deriv.context);
                    newPriority += deriv.priority;
                } else {
                    newSentence = List.append(newSentence, replacement);
                }
                found = true;
            } else {
                newSentence = List.append(newSentence, child);
            }
        });

        if (!found || bad) {
            /*if (name === 'p_picture_url')
                console.log('no placeholder ' + name + ', have ' + String(this.sentence));
            if (throwIfMissing)
                throw new TypeError('???');
            */
            return null;
        }

        return new Derivation(newValue, newSentence, newContext, newPriority);
    }

    static combine<ArgTypes extends unknown[], ResultType>(children : DerivationChildTuple<ArgTypes>,
                                                           semanticAction : SemanticAction<ArgTypes, ResultType>,
                                                           rulePriority : number) : Derivation<ResultType>|null {
        if (children.length === 1) {
            assert(!(children[0] instanceof Context));
            if (children[0] instanceof Derivation) {
                const newValue = semanticAction(... ([children[0].value] as ArgTypes));
                assert(newValue !== undefined);
                if (newValue === null)
                    return null;
                const newDerivation = new Derivation(newValue, children[0].sentence, children[0].context, children[0].priority);
                newDerivation.priority += rulePriority;
                return newDerivation;
            } else if (children[0] instanceof Placeholder) {
                const value = semanticAction(... ([undefined] as ArgTypes));
                assert(value !== undefined);
                if (value === null)
                    return null;
                return new Derivation(value, List.singleton(children[0]), null, rulePriority);
            } else { // constant or terminal
                const value = semanticAction(... ([undefined] as ArgTypes));
                assert(value !== undefined);
                if (value === null)
                    return null;
                return new Derivation(value, List.singleton(children[0]), null, rulePriority);
            }
        }

        let sentence : List<DerivationChild<unknown>> = List.Nil;
        const values : unknown[] = [];
        let newContext : Context|null = null;
        let newPriority = rulePriority;

        for (const child of children) {
            // does not go into the input sentence
            if (child instanceof Context) {
                newContext = child;
                values.push(child.info);
                continue;
            }

            if (typeof child === 'string' || child instanceof Placeholder) { // terminal
                values.push(undefined);
                sentence = List.append(sentence, child);
            } else if (child instanceof Derivation) {
                assert(Context.compatible(newContext, child.context));
                newContext = Context.meet(newContext, child.context);
                newPriority += child.priority;
                values.push(child.value);
                sentence = List.concat(sentence, child.sentence);
            }
        }

        //console.log('combine: ' + children.join(' ++ '));
        //console.log('values: ' + values.join(' , '));

        const value = semanticAction(...(values as ArgTypes));
        assert(value !== undefined);
        if (value === null)
            return null;
        return new Derivation(value, sentence, newContext, newPriority);
    }
}



// Combination operators: use to create a semantic function that, given two child derivations,
// produces a new derivation

function simpleCombine<ArgTypes extends unknown[], ResultType>(semanticAction : SemanticAction<ArgTypes, ResultType>,
                                                               flag ?: string|null,
                                                               topLevel = false) : CombinerAction<ArgTypes, ResultType> {
    return function(children : DerivationChildTuple<ArgTypes>, rulePriority : number) : Derivation<ResultType>|null {
        const result = Derivation.combine(children, semanticAction, rulePriority);
        if (result === null)
            return null;
        if (flag) {
            if (flag.startsWith('!')) {
                const sub = flag.substring(1);
                assert(sub === 'complete'); // add more flags here if necessary
                if (result[sub])
                    return null;
            } else {
                assert(flag === 'complete'); // add more flags here if necessary
                if (!result[flag])
                    return null;
            }
        }
        return result;
    };
}

function combineReplacePlaceholder<FirstType, SecondType, ResultType>(pname : string,
                                                                      semanticAction : SemanticAction<[FirstType, SecondType], ResultType>,
                                                                      options : ReplacePlaceholderOptions) : CombinerAction<[FirstType, SecondType], ResultType> {
    const f : CombinerAction<[FirstType, SecondType], ResultType> = function([c1, c2] : [DerivationChild<FirstType>, DerivationChild<SecondType>], rulePriority : number) {
        assert(c1 instanceof Derivation);
        assert(!(c2 instanceof Placeholder) && !(c2 instanceof Context));
        return c1.replacePlaceholder(pname, c2, semanticAction, options, rulePriority);
    };
    f.isReplacePlaceholder = true;
    return f;
}

class NonTerminal {
    symbol : string;
    index : number;

    constructor(symbol : string) {
        this.symbol = symbol;
        this.index = -1;
    }

    toString() : string {
        return `NT[${this.symbol}]`;
    }
}

type RNG = () => number;

class Choice {
    choices : string[];

    constructor(choices : string[]) {
        this.choices = choices;
    }

    choose(rng : RNG) : string {
        return uniform(this.choices, rng);
    }

    toString() : string {
        return `C[${this.choices.join('|')}]`;
    }
}

//const everything = new Set;

export {
    LogLevel,

    Placeholder,
    Derivation,
    Context,
    NonTerminal,
    Choice,

    simpleCombine,
    combineReplacePlaceholder
};
