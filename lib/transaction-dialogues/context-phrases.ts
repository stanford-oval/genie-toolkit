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
import { Ast } from 'thingtalk';
import { Temporal } from '@js-temporal/polyfill';

import { Describer } from '../utils/thingtalk';
import {
    PlaceholderReplacement,
    ReplacedConcatenation,
    ReplacedList,
    ReplacedResult
} from '../utils/template-string';
import * as C from '../templates/ast_manip';
import ThingpediaLoader, { ParsedPlaceholderPhrase } from '../templates/load-thingpedia';
import { ContextPhrase, ContextTable } from "../sentence-generator/types";
import { SlotBag } from '../templates/slot_bag';
import * as keyfns from '../templates/keyfns';

import { ContextInfo } from "./context-info";
import { contextNameKeyFn, NameList, nameListKeyFn } from './dialogue_acts/common';

const MAX_LIST_LENGTH = 5;

function tryReplacePlaceholderPhrase(phrase : ParsedPlaceholderPhrase,
                                     getParam : (name : string) => PlaceholderReplacement|undefined|null) : ReplacedResult|null {
    const replacements : Array<PlaceholderReplacement|undefined> = [];
    for (const param of phrase.names) {
        const replacement = getParam(param);
        if (replacement === null)
            replacements.push(undefined);
        else
            replacements.push(replacement);
    }
    const replacementCtx = { replacements, constraints: {} };
    return phrase.replaceable.replace(replacementCtx);
}

export function makeContextPhrase(symbol : number,
                                  value : ContextInfo,
                                  utterance : ReplacedResult = ReplacedResult.EMPTY,
                                  priority = 0) : ContextPhrase {
    return { symbol, utterance, value, priority, context: value, key: value.key };
}
export function makeExpressionContextPhrase(context : ContextInfo,
                                            symbol : number,
                                            value : Ast.Expression,
                                            utterance : ReplacedResult = ReplacedResult.EMPTY,
                                            priority = 0) : ContextPhrase {
    return { symbol, utterance, value, priority, context, key: keyfns.expressionKeyFn(value) };
}
export function makeValueContextPhrase(context : ContextInfo,
                                       symbol : number,
                                       value : Ast.Value,
                                       utterance : ReplacedResult = ReplacedResult.EMPTY,
                                       priority = 0) : ContextPhrase {
    return { symbol, utterance, value, priority, context, key: keyfns.valueKeyFn(value) };
}

function getQuery(expr : Ast.Expression) : Ast.Expression|null {
    if (expr instanceof Ast.ChainExpression)
        return getQuery(expr.last);

    if (expr.schema!.functionType === 'query')
        return expr;

    if (expr instanceof Ast.ProjectionExpression ||
        expr instanceof Ast.FilterExpression ||
        expr instanceof Ast.MonitorExpression)
        return getQuery(expr.expression);

    return null;
}

const _warned = new Set<string>();

/**
 * Create all the contextual phrases associated with a context.
 */
export class ContextPhraseCreator {
    private ctx : ContextInfo;
    private loader : ThingpediaLoader;
    private contextTable : ContextTable;
    private describer : Describer;

    constructor(ctx : ContextInfo,
                tpLoader : ThingpediaLoader,
                contextTable : ContextTable) {
        this.ctx = ctx;
        this.loader = tpLoader;
        this.contextTable = contextTable;
        this.describer = tpLoader.describer;
    }

    public make() {
        const phrases : ContextPhrase[] = [];

        if (this.ctx.state.dialogueAct === 'notification') {
            if (this.ctx.state.dialogueActParam) {
                const appName = this.ctx.state.dialogueActParam[0];
                assert(appName instanceof Ast.StringValue);
                phrases.push(makeValueContextPhrase(this.ctx,
                    this.contextTable.ctx_notification_app_name, appName, this.describer.describeArg(appName)!));
            }
        }

        // make phrases that describe the current and next action
        // these are used by the agent to form confirmations
        const current = this.ctx.current;
        if (current) {
            const description = this.describer.describeExpressionStatement(current.stmt);
            if (description !== null) {
                phrases.push(makeContextPhrase(this.contextTable.ctx_current_statement, this.ctx, description));
            } else {
                const code = current.stmt.prettyprint();
                if (!_warned.has(code)) {
                    console.error(`WARNING: failed to generate description for ${code}`);
                    _warned.add(code);
                }
            }

            const lastQuery = current.stmt.lastQuery ? getQuery(current.stmt.lastQuery) : null;
            if (lastQuery) {
                let description = this.describer.describeQuery(lastQuery);
                if (description !== null)
                    description = description.constrain('plural', 'other');
                if (description !== null) {
                    phrases.push(makeExpressionContextPhrase(this.ctx,
                        this.contextTable.ctx_current_query, lastQuery,
                        description));
                }
            }

            if (current.results!.error instanceof Ast.EnumValue) {
                phrases.push(...this.makeError(current.results!.error));
            } else {
                const results = current.results!.results;
                if (results.length > 0) {
                    const topResult = results[0];
                    phrases.push(...this.makeResult(topResult, results));
                    phrases.push(...this.makeNameList());
                } else if (!current.results!.error) {
                    phrases.push(...this.makeEmptyResult());
                }
            }
        }

        const next = this.ctx.next;
        if (next) {
            const description = this.describer.describeExpressionStatement(next.stmt);
            if (description !== null)
                phrases.push(makeContextPhrase(this.contextTable.ctx_next_statement, this.ctx, description));
        }

        return phrases;
    }

    private toJS(value : Ast.Value) {
        if (value instanceof Ast.DateValue || value instanceof Ast.RecurrentTimeSpecificationValue)
            value = value.normalize(this.loader.timezone || Temporal.Now.timeZone().id);
        return value.toJS();
    }

    private getDeviceName(resultItem : Ast.DialogueHistoryResultItem|undefined,
                          invocation : Ast.Invocation|Ast.FunctionCallExpression) {
        if (resultItem) {
            // check in the result first
            // until ThingTalk is fixed, this will be present only if there was no
            // projection and the compiler did not get in the way
            // FIXME we should fix the ThingTalk compiler though...
            if (resultItem.value.__device) {
                const entity = resultItem.value.__device;
                const description = this.describer.describeArg(entity, {});
                if (description)
                    return { value: entity, text: description };
            }
        }
        if (!(invocation instanceof Ast.Invocation))
            return undefined;

        let name;
        for (const in_param of invocation.selector.attributes) {
            if (in_param.name === 'name') {
                name = in_param.value;
                break;
            }
        }
        if (!name)
            return undefined;

        const entity = new Ast.EntityValue(invocation.selector.id, 'tt:device_id', name.toJS() as string);
        const description = this.describer.describeArg(entity, {});
        if (!description)
            return undefined;
        return { value: entity, text: description };
    }

    private makeListResult(allResults : Ast.DialogueHistoryResultItem[], phrases : ParsedPlaceholderPhrase[]) {
        const currentFunction = this.ctx.currentFunction!;
        const action = C.getInvocation(this.ctx.current!);

        const output = [];

        // list result, concatenate all parameters into each placeholder
        for (const candidate of phrases) {
            const bag = new SlotBag(currentFunction);

            const utterance = tryReplacePlaceholderPhrase(candidate, (param) => {
                if (param === '__device')
                    return this.getDeviceName(undefined, action);

                const arg = currentFunction.getArgument(param);
                // check if the argument was projected out, in which case we can't
                // use this result phrase
                if (!arg)
                    return null;
                if (arg.is_input) {
                    // use the top result value only
                    const topResult = allResults[0];
                    const value = topResult.value[param];
                    if (!value)
                        return null;
                    const text = this.describer.describeArg(value);
                    if (text === null)
                        return null;
                    bag.set(param, value);
                    return { value: value.toJS(), text };
                } else {
                    const arrayValue = new Ast.ArrayValue([]);
                    for (const result of allResults) {
                        const value = result.value[param];
                        if (!value)
                            return null;
                        arrayValue.value.push(value);
                    }
                    const text = this.describer.describeArg(arrayValue);
                    if (text === null)
                        return null;
                    bag.set(param, arrayValue);
                    return { value: arrayValue.toJS(), text };
                }
            });

            if (utterance) {
                const value = [this.ctx, bag];
                output.push({
                    symbol: this.contextTable.ctx_thingpedia_list_result,
                    utterance,
                    value,
                    priority: 0,
                    context: this.ctx,
                    key: keyfns.slotBagKeyFn(bag)
                });

                // in inference mode, we're done
                if (this.loader.flags.inference)
                    return output;
            }
        }

        return output;
    }

    private makeListConcatResult(allResults : Ast.DialogueHistoryResultItem[], phrases : ParsedPlaceholderPhrase[]) {
        const currentFunction = this.ctx.currentFunction!;
        const action = C.getInvocation(this.ctx.current!);

        const output = [];

        // list_concat result: concatenate phrases made from each result

        // don't concatenate too many phrases
        allResults = allResults.slice(0, MAX_LIST_LENGTH);

        outer: for (const candidate of phrases) {
            const bag = new SlotBag(currentFunction);

            const utterance = [];
            for (let resultIdx = 0; resultIdx < allResults.length; resultIdx++) {
                const result = allResults[resultIdx];
                const piece = tryReplacePlaceholderPhrase(candidate, (param) => {
                    if (param === '__index')
                        return { value: resultIdx+1, text: new ReplacedConcatenation([String(resultIdx+1)], {}, {}) };

                    // FIXME this should be extracted from the result instead
                    // so we can show different names for different devices
                    if (param === '__device')
                        return this.getDeviceName(result, action);

                    // set the bag to the array value, if we haven't already
                    if (!bag.has(param)) {
                        const arrayValue = new Ast.ArrayValue([]);
                        for (const result of allResults) {
                            const value = result.value[param];
                            if (!value)
                                return null;
                            arrayValue.value.push(value);
                        }
                        bag.set(param, arrayValue);
                    }

                    // then pick the current result
                    const value = result.value[param];
                    if (!value)
                        return null;
                    const text = this.describer.describeArg(value);
                    if (text === null)
                        return null;
                    return { value: value.toJS(), text };
                });
                if (piece === null)
                    continue outer;
                utterance.push(piece);
            }

            if (utterance.length) {
                const value = [this.ctx, bag];
                output.push({
                    symbol: this.contextTable.ctx_thingpedia_list_result,
                    utterance: new ReplacedList(utterance, this.loader.locale, '.'),
                    value,
                    priority: 0,
                    context: this.ctx,
                    key: keyfns.slotBagKeyFn(bag)
                });

                // in inference mode, we're done
                if (this.loader.flags.inference)
                    return output;
            }
        }

        return output;
    }

    private makeTopResult(topResult : Ast.DialogueHistoryResultItem, phrases : ParsedPlaceholderPhrase[]) {
        const currentFunction = this.ctx.currentFunction!;
        const action = C.getInvocation(this.ctx.current!);

        const output = [];

        // top result
        for (const candidate of phrases) {
            const bag = new SlotBag(currentFunction);

            const utterance = tryReplacePlaceholderPhrase(candidate, (param) => {
                if (param === '__device')
                    return this.getDeviceName(topResult, action);

                const value = topResult.value[param];
                if (!value)
                    return null;
                const text = this.describer.describeArg(value);
                if (text === null)
                    return null;
                bag.set(param, value);
                return { value: value.toJS(), text };
            });

            if (utterance) {
                output.push({
                symbol: this.contextTable.ctx_thingpedia_result,
                utterance,
                value: bag,
                priority: 0,
                context: this.ctx,
                key: keyfns.slotBagKeyFn(bag)
                });

            // in inference mode, we're done
                if (this.loader.flags.inference)
                    return output;
            }
        }

        return output;
    }

    private makeResult(topResult : Ast.DialogueHistoryResultItem, allResults : Ast.DialogueHistoryResultItem[]) {
        // note: this is not the same as ctx.currentFunction (aka ctx.current!.stmt.expression.schema!)
        // because the value of is_list will be different if the last function is not
        // a list query but it is invoked in a chain with a list function
        const currentFunction = this.ctx.current!.stmt.last.schema!;
        const phrases = this.loader.getResultPhrases(currentFunction.qualifiedName);

        const output = [];

        // if we have multiple results, we prefer, in order:
        // - list result
        // - list_concat result
        // - top result
        //
        // if we have one result, we prefer, in order:
        // - top result
        // - list_concat result
        // - list result

        if (allResults.length > 1) {
            output.push(...this.makeListResult(allResults, phrases.list));
            if (this.loader.flags.inference && output.length > 0)
                return output;

            output.push(...this.makeListConcatResult(allResults, phrases.list_concat));
            if (this.loader.flags.inference && output.length > 0)
                return output;

            if (!currentFunction.is_list) {
                // if the function is not a list, but we're getting multiple
                // results, it means it was invoked over multiple devices, or multiple
                // times in a row using a chain expression
                // concatenates all the result phrases as if they were of "list_concat"
                // type, because "list_concat" does not make sense for a non-list
                // function
                output.push(...this.makeListConcatResult(allResults, phrases.top));
            } else {
                output.push(...this.makeTopResult(topResult, phrases.top));
            }
        } else {
            output.push(...this.makeTopResult(topResult, phrases.top));
            if (this.loader.flags.inference && output.length > 0)
                return output;

            output.push(...this.makeListConcatResult(allResults, phrases.list_concat));
            if (this.loader.flags.inference && output.length > 0)
                return output;

            output.push(...this.makeListResult(allResults, phrases.list));
        }

        return output;
    }

    private makeEmptyResult() {
        const currentFunction = this.ctx.currentFunction!;
        const phrases = this.loader.getResultPhrases(currentFunction.qualifiedName);

        const action = C.getInvocation(this.ctx.current!);
        const isAction = currentFunction.functionType === 'action';

        const output = [];
        for (const candidate of (isAction ? phrases.top : phrases.empty)) {
            const bag = new SlotBag(currentFunction);
            const utterance = tryReplacePlaceholderPhrase(candidate, (param) => {
                let value = null;
                for (const in_param of action.in_params) {
                    if (in_param.name === param) {
                        value = in_param.value;
                        break;
                    }
                }
                if (!value)
                    return null;
                const text = this.describer.describeArg(value);
                if (text === null)
                    return null;
                bag.set(param, value);
                return { value: value.toJS(), text };
            });

            if (utterance) {
                output.push({
                    symbol: isAction ? this.contextTable.ctx_thingpedia_result : this.contextTable.ctx_thingpedia_empty_result,
                    utterance,
                    value: bag,
                    priority: 0,
                    context: this.ctx,
                    key: keyfns.slotBagKeyFn(bag)
                });

                // in inference mode, we're done
                if (this.loader.flags.inference)
                    return output;
            }
        }

        return output;
    }

    private makeOneNameList(descriptions : ReplacedResult[], length : number) {
        const utterance = new ReplacedList(descriptions.slice(0, length), this.loader.locale, undefined);
        const value : NameList = { ctx: this.ctx, results: this.ctx.results!.slice(0, length) };
        return {
            symbol: this.contextTable.ctx_result_name_list,
            utterance,
            value,
            priority: length === 2 || length === 3 ? length : 0,
            context: this.ctx,
            key: nameListKeyFn(value)
        };
    }

    private makeName(utterance : ReplacedResult, name : Ast.Value) {
        const value = { ctx: this.ctx, name };
        return {
            symbol: this.contextTable.ctx_result_name,
            utterance,
            value,
            priority: 0,
            context: this.ctx,
            key: contextNameKeyFn(value)
        };
    }

    private makeNameList() : ContextPhrase[] {
        const describer = this.loader.describer;

        const phrases : ContextPhrase[] = [];

        const descriptions : ReplacedResult[] = [];

        const results = this.ctx.results!;
        for (let index = 0; index < results.length; index++) {
            const value = results[index].value.id;
            if (!value)
                break;
            const description = describer.describeArg(value);
            if (!description)
                break;
            descriptions.push(description);
        }

        phrases.push(...descriptions.slice(0, 3).map((d, i) => this.makeName(d, results[i].value.id)));

        if (descriptions.length <= 1)
            return phrases;

        // add a name list of size 2, one of size 3, and one that includes all
        // names in the list
        // the last one will be used to support arbitrary slices
        if (descriptions.length > 2)
            phrases.push(this.makeOneNameList(descriptions, 2));
        if (descriptions.length > 3)
            phrases.push(this.makeOneNameList(descriptions, 3));
        phrases.push(this.makeOneNameList(descriptions, descriptions.length));

        return phrases;
    }

    private makeError(error : Ast.EnumValue) {
        const currentFunction = this.ctx.currentFunction!;
        const phrases = this.loader.getErrorMessages(currentFunction.qualifiedName)[error.value];
        if (!phrases)
            return [];

        const action = C.getInvocation(this.ctx.current!);

        const output = [];
        for (const candidate of phrases) {
            const bag = new SlotBag(currentFunction);
            const utterance = tryReplacePlaceholderPhrase(candidate, (param) => {
                if (param === '__device')
                    return this.getDeviceName(undefined, action);

                let value = null;
                for (const in_param of action.in_params) {
                    if (in_param.name === param) {
                        value = in_param.value;
                        break;
                    }
                }
                if (!value)
                    return null;
                const text = this.describer.describeArg(value);
                if (text === null)
                    return null;
                bag.set(param, value);
                return { value: value.isConstant() ? this.toJS(value) : value, text };
            });

            if (utterance) {
                const value : C.ErrorMessage = { code: error.value, bag };
                output.push({
                    symbol: this.contextTable.ctx_thingpedia_error_message,
                    utterance,
                    value,
                    priority: 0,
                    context: this.ctx,
                    key: keyfns.errorMessageKeyFn(value)
                });

                // in inference mode, we're done
                if (this.loader.flags.inference)
                    return output;
            }
        }

        return output;
    }
}
