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

import * as Tp from 'thingpedia';
import { Ast, } from 'thingtalk';
import assert from 'assert';

import * as I18n from '../../i18n';
import { EntityRecord, getBestEntityMatch } from '../../dialogue-agent/entity-linking/entity-finder';
import { SimulationDatabase } from '../../dialogue-agent/simulator/types';

/**
 * Convert a ThingTalk dialogue state to a set of MultiWOZ-style slots.
 */
export default class SlotExtractor {
    private _tpClient : Tp.BaseClient|null;
    private _database : SimulationDatabase|undefined;
    private _tokenizer : I18n.BaseTokenizer;
    private _omittedSlots : string[];

    private _cachedEntityMatches : Map<string, EntityRecord>;

    constructor(locale : string,
                tpClient : Tp.BaseClient|null,
                database : SimulationDatabase|undefined,
                omittedSlots = ['train-name']) {
        this._database = database;
        this._tpClient = tpClient;
        this._omittedSlots = omittedSlots;
        this._tokenizer = I18n.get(locale).getTokenizer();

        this._cachedEntityMatches = new Map;
    }

    private _isWellKnownEntity(entityType : string) {
        switch (entityType) {
        case 'tt:username':
        case 'tt:hashtag':
        case 'tt:picture':
        case 'tt:url':
        case 'tt:email_address':
        case 'tt:phone_number':
        case 'tt:path_name':
        case 'tt:device':
        case 'tt:function':
            return true;
        default:
            return false;
        }
    }

    private _tokenizeSlot(value : string) {
        return this._tokenizer.tokenize(value).rawTokens.join(' ');
    }

    private async _resolveEntity(value : Ast.EntityValue) : Promise<EntityRecord> {
        if (this._isWellKnownEntity(value.type)) {
            assert(value.value);
            return { value: value.value!, name: value.display||'', canonical: value.value! };
        }

        const searchKey = value.display||value.value;
        assert(searchKey);
        const cacheKey = value.type + '/' + value.value + '/' + searchKey;
        let resolved = this._cachedEntityMatches.get(cacheKey);
        if (resolved)
            return resolved;

        if (this._database && this._database.has(value.type)) {
            // resolve as ID entity from the database (simulate issuing a query for it)
            const ids = this._database.get(value.type)!.map((entry) => {
                const id = entry.id as { value : string, display : string };
                return {
                    value: id.value,
                    name: id.display,
                    canonical: id.display.toLowerCase()
                };
            });
            if (value.value) {
                for (const id of ids) {
                    if (id.value === value.value) {
                        resolved = id;
                        break;
                    }
                }
            }
            if (!resolved)
                resolved = getBestEntityMatch(searchKey, value.type, ids);
            this._cachedEntityMatches.set(cacheKey, resolved);
            return resolved;
        }

        // resolve as regular Thingpedia entity
        const candidates = await this._tpClient!.lookupEntity(value.type, searchKey);
        resolved = getBestEntityMatch(searchKey, value.type, candidates.data);
        this._cachedEntityMatches.set(cacheKey, resolved);
        return resolved;
    }

    private async _valueToSlot(value : Ast.Value) : Promise<string> {
        // HACK
        if (value instanceof Ast.ComputationValue)
            return this._valueToSlot(value.operands[0]);
        if (value instanceof Ast.EntityValue) {
            const resolved = await this._resolveEntity(value);
            if (resolved)
                return resolved.canonical;
            return this._tokenizeSlot(value.display||'');
        }
        if (value instanceof Ast.BooleanValue)
            return value.value ? 'yes' : 'no';
        if (value instanceof Ast.LocationValue) {
            if (value.value instanceof Ast.RelativeLocation)
                return value.value.relativeTag;
            if (value.value instanceof Ast.AbsoluteLocation)
                return this._tokenizeSlot(value.value.display||'');
            // unresolved
            assert(value.value instanceof Ast.UnresolvedLocation);
            return this._tokenizeSlot(value.value.name);
        }
        if (value instanceof Ast.ContextRefValue)
            return 'context-' + value.name;

        if (value instanceof Ast.StringValue) {
            // "tokenize" the value, because the prediction will also be tokenized
            return this._tokenizeSlot(value.toJS());
        }

        if (value instanceof Ast.DateValue) {
            const date = value.value;
            if (date instanceof Ast.DateEdge)
                return date.edge + ' ' + date.unit;
            else if (date instanceof Ast.WeekDayDate)
                return date.weekday;
        }

        if (value instanceof Ast.EventValue) {
            if (value.name === null)
                return '$event';
            else
                return '$' + value.name;
        }

        // everything else (time, currency, number, enum), use JS value
        return String(value.toJS()).toLowerCase();
    }

    async extractSlots(state : Ast.Node) {
        const slotValues : Record<string, Ast.Value> = {};
        let currentDomain : string|undefined;

        function nameToSlot(domain : string, name : string) {
            if (name === 'id' || name === domain)
                return domain + '-name';
            const slotKey = domain + '-' + name.replace(/_/g, '-');
            return slotKey;
        }

        // note: this function relies on the precise visit order, in which an invocation
        // is visited before the boolean expressions that use the output of that invocation
        state.visit(new class extends Ast.NodeVisitor {
            visitInvocation(invocation : Ast.Invocation) {
                const selector = invocation.selector;
                assert(selector instanceof Ast.DeviceSelector);
                const device = selector.kind;
                const domain = device.substring(device.lastIndexOf('.')+1).toLowerCase();
                currentDomain = domain;

                // delete all slots for this domain (they'll be set again right after)
                for (const arg of invocation.schema!.iterateArguments()) {
                    if (arg.name === currentDomain) {
                        // do not erase the "id" slot just because we have an action!
                        assert(arg.type.isEntity);
                        continue;
                    }
                    const slotKey = nameToSlot(domain, arg.name);
                    delete slotValues[slotKey];
                }

                for (const in_param of invocation.in_params) {
                    if (in_param.value.isUndefined || in_param.value.isVarRef)
                        continue;
                    const slotKey = nameToSlot(domain, in_param.name);
                    slotValues[slotKey] = in_param.value;
                }

                // do not recurse
                return false;
            }

            visitDialogueHistoryItem(item : Ast.DialogueHistoryItem) {
                // recurse only if this item comes from the user and not the agent
                return item.confirm !== 'proposed';
            }

            visitDontCareBooleanExpression(expr : Ast.DontCareBooleanExpression) {
                const slotKey = nameToSlot(currentDomain!, expr.name);
                slotValues[slotKey] = new Ast.Value.Enum('dontcare');
                return false;
            }

            visitAtomBooleanExpression(expr : Ast.AtomBooleanExpression) {
                if (expr.value.isUndefined || expr.value.isVarRef)
                    return false;

                const slotKey = nameToSlot(currentDomain!, expr.name);
                if (expr.operator === 'in_array') // multiple values, pick the first one
                    slotValues[slotKey] = (expr.value as Ast.ArrayValue).value[0];
                else
                    slotValues[slotKey] = expr.value;
                return false;
            }

            visitNotBooleanExpression(expr : Ast.NotBooleanExpression) {
                // explicitly do not recurse into "not" operators
                return false;
            }

            visitOrBooleanExpression(expr : Ast.OrBooleanExpression) {
                // explicitly do not recurse into "or" operators
                // (unless they are an "or" of one operand)
                return expr.operands.length === 1;
            }
        });

        // remove slots that are not in multiwoz
        for (const slot of this._omittedSlots)
            delete slotValues[slot];

        // resolve entities and map Ast.Value to a string we can compare for equality
        const slotStrings : Record<string, string> = {};
        for (const key in slotValues)
            slotStrings[key] = await this._valueToSlot(slotValues[key]);

        return slotStrings;
    }
}
