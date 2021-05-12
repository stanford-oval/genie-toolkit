// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
//         Sina Semnani <sinaj@cs.stanford.edu>

import assert from 'assert';
import { Ast, Syntax, Type } from "thingtalk";

import { Describer } from '../../lib/utils/thingtalk';
import * as I18n from "../../lib/i18n";
import { EntityMap } from "../../lib/utils/entity-utils";
import { coin, randint, uniform } from '../../lib/utils/random';
import { Replaceable, ReplacedConcatenation, ReplacedList, ReplacedResult } from "../../lib/utils/template-string";

class IntroduceErrorVisitor extends Ast.NodeVisitor {
    anyChange = false;
    private _entities : EntityMap = {};
    private _tokens : string[];
    private _currentEntities : EntityMap;
    private _rng : () => number;
    private _langPack : I18n.LanguagePack;
    private _feedbacks : ReplacedResult[] = [];
    private _describer : Describer;
    private _currentSchema : Ast.FunctionDef|null = null;

    constructor(options : {
        rng : () => number;
        locale : string;
        tokens : string[];
        currentEntities : EntityMap;
    }) {
        super();

        this._rng = options.rng;
        this._tokens = options.tokens;
        this._currentEntities = options.currentEntities;
        this._langPack = I18n.get(options.locale);
        this._describer = new Describer(options.locale, undefined,
            new Syntax.SequentialEntityAllocator(this._entities));
    }

    getFeedback() {
        const list = new ReplacedList(this._feedbacks, this._langPack.locale, 'conjunction');
        return this._langPack.postprocessNLG(list.chooseSample(this._rng), this._entities, {
            timezone: 'America/Los_Angeles',

            getPreferredUnit() {
                return 'F';
            }
        });
    }

    private _interp(x : string, args : Record<string, string|number|ReplacedResult|null>) : ReplacedResult|null {
        const replacements = [];
        const names = [];
        for (const key in args) {
            names.push(key);
            const value = args[key];
            if (value === null)
                return null;
            replacements.push({
                text: typeof value === 'string' ? this._const(value) :
                    typeof value === 'number' ? new ReplacedConcatenation([String(value)], {}, {}) : value,
                value,
            });
        }

        const tmpl = Replaceable.get(x, this._langPack, names);
        return tmpl.replace({ replacements, constraints: {} });
    }

    private _const(x : string) {
        // even though x is a constant, we parse it as a template so we get all the flags and the choices
        const res =  this._interp(x, {});
        assert(res);
        return res;
    }

    private _findEntityInSentence(tokens : string[]) {
        for (let i = 0; i < this._tokens.length - tokens.length + 1; i++) {
            let found = true;
            for (let j = 0; j < tokens.length; j++) {
                if (tokens[j] !== this._tokens[i+j]) {
                    found = false;
                    break;
                }
            }
            if (found)
                return i;
        }
        return undefined;
    }

    private _sampleValue(arg : Ast.ArgumentDef) : Ast.Value|undefined {
        const type = arg.type;
        if (type === Type.Number) {
            const minNumber = arg.getImplementationAnnotation<number>('min_number') ?? 1;
            const maxNumber = arg.getImplementationAnnotation<number>('max_number') ?? 1000;

            return new Ast.NumberValue(randint(minNumber, maxNumber, this._rng));
        } else if (type instanceof Type.Entity) {
            const choices : Ast.EntityValue[] = [];

            for (const token in this._currentEntities) {
                if (token.startsWith('GENERIC_ENTITY_' + type.type + '_')) {
                    const entity = this._currentEntities[token] as Syntax.GenericEntity;
                    choices.push(new Ast.EntityValue(entity.value, type.type, entity.display));
                }
            }

            if (choices.length)
                return uniform(choices, this._rng);
            return undefined;
        } else if (type === Type.Time) {
            const choices : Ast.AbsoluteTime[] = [];
            for (const token in this._currentEntities) {
                if (token.startsWith('TIME_')) {
                    const entity = this._currentEntities[token] as Syntax.TimeEntity;
                    choices.push(new Ast.AbsoluteTime(entity.hour, entity.minute, entity.second));
                }
            }

            if (choices.length > 0)
                return new Ast.TimeValue(uniform(choices, this._rng));
            return undefined;
        } else if (type instanceof Type.Enum) {
            return new Ast.EnumValue(uniform(type.entries!, this._rng));
        }

        return undefined;
    }

    private _transformValue(existing : Ast.Value, arg : Ast.ArgumentDef) : Ast.Value {
        if (existing instanceof Ast.NumberValue) {
            const minNumber = arg.getImplementationAnnotation<number>('min_number') ?? 1;
            const maxNumber = arg.getImplementationAnnotation<number>('max_number') ?? 1000;

            const choices : number[] = [];
            if (existing.value > minNumber)
                choices.push(existing.value - 1);
            if (existing.value < maxNumber)
                choices.push(existing.value + 1);

            for (const token in this._currentEntities) {
                if (token.startsWith('NUMBER_'))
                    choices.push(this._currentEntities[token] as number);
            }

            if (choices.length > 0)
                existing.value = uniform(choices, this._rng);
            return existing;
        } else if (existing instanceof Ast.EntityValue) {
            const choices : Ast.EntityValue[] = [];

            for (const token in this._currentEntities) {
                if (token.startsWith('GENERIC_ENTITY_' + existing.type + '_')) {
                    const entity = this._currentEntities[token] as Syntax.GenericEntity;
                    choices.push(new Ast.EntityValue(entity.value, existing.type, entity.display));
                }
            }

            if (existing.display) {
                const tokens = this._langPack.getTokenizer().tokenize(existing.display).rawTokens;
                const beginIndex = this._findEntityInSentence(tokens);
                if (beginIndex !== undefined) {
                    // add an extra token at the beginning
                    if (beginIndex > 0)
                        choices.push(new Ast.EntityValue(existing.value, existing.type, this._tokens[beginIndex-1] + ' ' + existing.display));

                    // add an extra token at the end
                    if (beginIndex + tokens.length < this._tokens.length)
                        choices.push(new Ast.EntityValue(existing.value, existing.type, existing.display + ' ' + this._tokens[beginIndex + tokens.length]));

                    if (tokens.length > 1) {
                        // cut the first token
                        choices.push(new Ast.EntityValue(existing.value, existing.type, tokens.slice(1).join(' ')));

                        // cut the last token
                        choices.push(new Ast.EntityValue(existing.value, existing.type, tokens.slice(0, -1).join(' ')));
                    }
                }
            }

            if (choices.length > 0)
                return uniform(choices, this._rng);
            return existing;
        } else if (existing instanceof Ast.EnumValue) {
            const type = arg.type;
            assert(type instanceof Type.Enum);

            existing.value = uniform(type.entries!, this._rng);
            return existing;
        } else if (existing instanceof Ast.TimeValue) {
            const choices : Ast.AbsoluteTime[] = [];
            for (const token in this._currentEntities) {
                if (token.startsWith('TIME_')) {
                    const entity = this._currentEntities[token] as Syntax.TimeEntity;
                    choices.push(new Ast.AbsoluteTime(entity.hour, entity.minute, entity.second));
                }
            }

            if (choices.length > 0)
                existing.value = uniform(choices, this._rng);
            return existing;
        }

        // fallback to no change
        return existing;
    }

    visitInvocation(invocation : Ast.Invocation) {
        if (this.anyChange)
            return false;

        const seenParams = new Set<string>();
        for (let i = 0; i < invocation.in_params.length; i++) {
            const in_param = invocation.in_params[i];
            if (in_param.value.isUndefined)
                continue;
            seenParams.add(in_param.name);
        }

        const newInParams : Ast.InputParam[] = [];
        for (let i = 0; i < invocation.in_params.length; i++) {
            const in_param = invocation.in_params[i];
            if (in_param.value.isUndefined)
                continue;
            const currentArg = invocation.schema!.getArgument(in_param.name)!;

            const nameReplacementCandidates : string[] = [];
            for (const arg2 of invocation.schema!.iterateArguments()) {
                if (!arg2.is_input)
                    continue;
                if (arg2.name === currentArg.name)
                    continue;
                if (seenParams.has(arg2.name))
                    continue;
                if (arg2.type.equals(currentArg.type))
                    nameReplacementCandidates.push(arg2.name);
            }

            if (coin(0.1, this._rng)) {
                // remove the parameter entirely
                const feedback = this._interp(`
                    {the \${argument} {is|should be} \${value}
                    |i {need|want} the \${argument} to be \${value}
                    }`, {
                    argument: this._describer.getArgCanonical(invocation.schema!, currentArg.name),
                    value: this._describer.describeArg(in_param.value)
                });
                if (feedback) {
                    this.anyChange = true;
                    this._feedbacks.push(feedback);

                    // skip adding to newInParams
                    seenParams.delete(currentArg.name);
                    continue;
                } else {
                    newInParams.push(in_param);
                }
            }

            newInParams.push(in_param);
            if (nameReplacementCandidates.length > 0 && coin(0.05, this._rng)) {
                // replace the parameter name

                const choice = uniform(nameReplacementCandidates, this._rng);
                const feedback = this._interp(`
                    {i {meant|want|asked for|said} the \${correct} not the \${wrong}
                    |i {meant|said} the \${correct} should be \${value}, not the \${wrong}
                    |the \${correct} is \${value}, not the \${wrong}
                    }`, {
                    correct: this._describer.getArgCanonical(invocation.schema!, currentArg.name),
                    wrong: this._describer.getArgCanonical(invocation.schema!, choice),
                    value: this._describer.describeArg(in_param.value)
                });
                if (feedback) {
                    seenParams.delete(in_param.name);
                    in_param.name = choice;
                    seenParams.add(choice);
                    this.anyChange = true;
                    this._feedbacks.push(feedback);
                }
            } else if (coin(0.1, this._rng)) {
                // change the value

                const wrongValue = this._transformValue(in_param.value, currentArg);
                if (wrongValue.equals(in_param.value))
                    continue;
                const feedback = this._interp(`
                    {the \${arg} should be \${correct} instead {{,|} not \${wrong}|}
                    |i want \${correct} not \${wrong}
                    |i want the \${arg} to be \${correct} {not \${wrong}|}
                    }`, {
                    correct: this._describer.describeArg(in_param.value),
                    wrong: this._describer.describeArg(wrongValue),
                    arg: this._describer.getArgCanonical(invocation.schema!, in_param.name),
                });
                if (feedback) {
                    in_param.value = wrongValue;
                    this.anyChange = true;
                    this._feedbacks.push(feedback);
                }
            }
        }
        invocation.in_params = newInParams;

        for (const arg of invocation.schema!.iterateArguments()) {
            if (seenParams.has(arg.name))
                continue;
            if (!arg.is_input)
                continue;
            if (arg.type.isEntity)
                continue;

            if (coin(0.1, this._rng)) {
                // hallucinate the parameter
                const value = this._sampleValue(arg);
                if (value) {
                    const feedback = this._interp(`
                        {i {never said|did not say} the \${arg} {is|should be} \${value}
                        |i {never said anything about|did not mention} the \${arg}
                        }`, {
                        arg: this._describer.getArgCanonical(invocation.schema!, arg.name),
                        value: this._describer.describeArg(value),
                    });
                    if (feedback) {
                        invocation.in_params.push(new Ast.InputParam(null, arg.name, value));
                        this.anyChange = true;
                        this._feedbacks.push(feedback);
                    }
                    seenParams.add(arg.name);
                }
            }
        }

        // restore $? values (or we'll crash in execution)
        for (const arg of invocation.schema!.iterateArguments()) {
            if (seenParams.has(arg.name))
                continue;
            if (!arg.is_input || !arg.required)
                continue;
            invocation.in_params.push(new Ast.InputParam(null, arg.name, new Ast.Value.Undefined(true)));
        }

        return true;
    }

    visitAtomBooleanExpression(expr : Ast.AtomBooleanExpression) {
        const schema = this._currentSchema!;
        const currentArg = schema.getArgument(expr.name)!;

        const nameReplacementCandidates : string[] = [];
        for (const arg2 of schema.iterateArguments()) {
            if (arg2.name === currentArg.name)
                continue;
            if (arg2.type.equals(currentArg.type))
                nameReplacementCandidates.push(arg2.name);
        }

        if (nameReplacementCandidates.length > 0 && coin(0.1, this._rng)) {
            // replace the parameter name

            const choice = uniform(nameReplacementCandidates, this._rng);
            const feedback = this._interp(`
                {i {meant|want|asked for|said} the \${correct} not the \${wrong}
                |i {meant|said} the \${correct} should be \${value}, not the \${wrong}
                |the \${correct} is \${value}, not the \${wrong}
                }`, {
                correct: this._describer.getArgCanonical(schema, currentArg.name),
                wrong: this._describer.getArgCanonical(schema, choice),
                value: this._describer.describeArg(expr.value)
            });
            if (feedback) {
                expr.name = choice;
                this.anyChange = true;
                this._feedbacks.push(feedback);
            }
        } else if (coin(0.05, this._rng)) {
            const wrongValue = this._transformValue(expr.value, currentArg);
            if (wrongValue.equals(expr.value))
                return true;
            const feedback = this._interp(`
                {the \${arg} should be \${correct} instead {{,|} not \${wrong}|}
                |i want \${correct} not \${wrong}
                |i want the \${arg} to be \${correct} {not \${wrong}|}
                }`, {
                correct: this._describer.describeArg(expr.value),
                wrong: this._describer.describeArg(wrongValue),
                arg: this._describer.getArgCanonical(schema, expr.name),
            });
            if (feedback) {
                expr.value = wrongValue;
                this.anyChange = true;
                this._feedbacks.push(feedback);
            }
        }

        return true;
    }

    visitAndBooleanExpression(expr : Ast.AndBooleanExpression) {
        const schema = this._currentSchema!;
        for (let i = 0; i < expr.operands.length; i++) {
            if (coin(0.1, this._rng)) {
                const feedback = this._interp(`
                    {i also need that \${filter}
                    |and also, \${filter}, correct?
                    }`, {
                    filter: this._describer.describeFilter(expr.operands[i], schema)
                });
                if (feedback) {
                    expr.operands[i] = Ast.BooleanExpression.True;
                    this.anyChange = true;
                    this._feedbacks.push(feedback);
                }
            }
        }

        return true;
    }

    visitFilterExpression(expr : Ast.FilterExpression) {
        this._currentSchema = expr.schema;
        return true;
    }

    visitProjectionExpression(expr : Ast.ProjectionExpression) {
        if (expr.args.length <= 1)
            return true;
        if (coin(0.1, this._rng)) {
            const removed = uniform(expr.args, this._rng);
            const feedback = this._interp(`
                    {i {will|} also need the \${arg}
                    |what is the \${arg}?
                    |i asked for the \${arg} too
                    }`, {
                arg: this._describer.getArgCanonical(expr.schema!, removed)
            });
            if (feedback) {
                expr.args = expr.args.filter((a) => a !== removed);
                this.anyChange = true;
                this._feedbacks.push(feedback);
            }
        }
        return true;
    }
}

export function introduceErrorsToUserTarget(userTarget : Ast.DialogueState,
                                            options : {
                                                locale : string,
                                                rng : () => number,
                                                tokens : string[],
                                                currentEntities : EntityMap
                                            }) : [Ast.DialogueState, string]|undefined {
    // clone everything before doing anything else
    const clone = userTarget.clone();

    for (let attempt = 0; attempt < 5; attempt++) {
        const visitor = new IntroduceErrorVisitor(options);
        clone.visit(visitor);
        if (visitor.anyChange)
            return [clone.optimize(), visitor.getFeedback()];
    }

    return undefined;
}
