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
import { Ast, Type } from 'thingtalk';

import * as C from '../ast_manip';
import {
    ContextInfo
} from '../state_manip';
import { SlotBag } from '../slot_bag';

import {
    isInfoPhraseCompatibleWithResult,
    isSlotCompatibleWithResult,
} from './common';

const MAX_RESULTS = 3;

// a phrase that describes one or more results using slots
export interface ResultPhrase {
    ctx : ContextInfo;
    info : SlotBag;
    compatible : number[];
}

export function resultPhraseKeyFn(phrase : ResultPhrase) {
    return {
        functionName: phrase.ctx.currentFunction!.qualifiedName
    };
}

export function mergeResultPhrase(p1 : ResultPhrase, p2 : ResultPhrase) : ResultPhrase|null {
    assert(p1.ctx === p2.ctx);

    // check that both are compatible with some result, by intersecting
    // the compatible arrays
    const compatible : number[] = [];
    for (const resultIdx of p1.compatible) {
        if (p2.compatible.includes(resultIdx))
            compatible.push(resultIdx);
    }
    if (compatible.length === 0)
        return null;

    // this will also check that they don't both say the same thing
    const merged = SlotBag.merge(p1.info, p2.info);
    if (!merged)
        return null;

    return { ctx: p1.ctx, info: merged, compatible };
}

export function makeResultPhrase(ctx : ContextInfo, info : SlotBag) : ResultPhrase|null {
    if (info.schema !== null) {
        if (!C.isSameFunction(ctx.currentFunction!, info.schema))
            return null;
    }

    // check that the filter is compatible with at least one of the top 3 results
    const results = ctx.results!;
    const compatible : number[] = [];
    for (let i = 0; i < Math.min(MAX_RESULTS, results.length); i++) {
        if (isInfoPhraseCompatibleWithResult(results[i], info)) {
            compatible.push(i);
            break;
        }
    }
    if (compatible.length === 0)
        return null;

    if (info.schema !== null)
        return { ctx, info, compatible };

    const clone = info.clone();
    clone.schema = ctx.currentFunction;
    return { ctx, info: clone, compatible };
}

function addSlotToBagCloned(bag : SlotBag, filter : Ast.BooleanExpression) : [SlotBag, string[]]|null {
    if (filter instanceof Ast.AndBooleanExpression) {
        // we treat "serves Italian and Chinese" the same as "serves Italian or Chinese"

        let newBag : SlotBag|null = bag;
        const newSlots : string[] = [];
        for (const operand of filter.operands) {
            const added = addSlotToBagCloned(newBag, operand);
            if (!added)
                return null;
            newBag = added[0];
            newSlots.push(...added[1]);
        }
        return [newBag, newSlots];
    }
    if (!(filter instanceof Ast.AtomBooleanExpression))
        return null;

    const arg = bag.schema!.getArgument(filter.name);
    if (!arg || arg.is_input)
        return null;
    const ptype = arg.type;
    const vtype = filter.value.getType();
    if (filter.operator === 'contains' || filter.operator === 'contains~') {
        if (!ptype.equals(new Type.Array(vtype)))
            return null;
        const existing = bag.get(filter.name);
        if (existing) {
            assert(existing instanceof Ast.ArrayValue);
            if (existing.value.some((v) => v.equals(filter.value)))
                return null;
            existing.value.push(filter.value);
        } else {
            bag.set(filter.name, new Ast.Value.Array([filter.value]));
        }
        return [bag, [filter.name]];
    } else {
        if (filter.operator !== '==' && filter.operator !== '=~')
            return null;
        if (!ptype.equals(vtype))
            return null;
        if (bag.has(filter.name))
            return null;
        bag.set(filter.name, filter.value);
        return [bag, [filter.name]];
    }

}

export function addSlotToBag(bag : SlotBag, filter : C.FilterSlot) : [SlotBag, string[]]|null {
    const schema = bag.schema!;
    if (!C.isSameFunction(schema, filter.schema))
        return null;

    let name;
    if (filter.ast instanceof Ast.AndBooleanExpression) {
        const atom = filter.ast.operands[0];
        if (!(atom instanceof Ast.AtomBooleanExpression))
            return null;
        name = atom.name;
    } else {
        if (!(filter.ast instanceof Ast.AtomBooleanExpression))
            return null;
        name = filter.ast.name;
    }
    if (bag.has(name))
        return null;

    const clone = bag.clone();
    return addSlotToBagCloned(clone, filter.ast);
}

export function addSlotToResultPhrase(phrase : ResultPhrase, filter : C.FilterSlot) : ResultPhrase|null {
    const added = addSlotToBag(phrase.info, filter);
    if (!added)
        return null;
    const [newBag, newSlots] = added;

    const compatible : number[] = [];
    const results = phrase.ctx.results!;
    for (const resultIdx of phrase.compatible) {
        const result = results[resultIdx];
        let good = true;
        for (const newSlot of newSlots) {
            if (!isSlotCompatibleWithResult(result, newSlot, newBag.get(newSlot)!)) {
                good = false;
                break;
            }
        }
        if (good)
            compatible.push(resultIdx);
    }
    if (compatible.length === 0)
        return null;
    return { ctx: phrase.ctx, info: newBag, compatible };
}

export interface DirectAnswerPhrase {
    result : ResultPhrase;
    name : Ast.Value;
    index : number;
}

export function directAnswerPhraseKeyFn(phrase : DirectAnswerPhrase) {
    return {
        index: phrase.index,
        type: phrase.name.getType()
    };
}

export function checkDirectAnswerPhrase(res : ResultPhrase, name : Ast.Value) : DirectAnswerPhrase|null {
    const results = res.ctx.results!;
    for (const resultIdx of res.compatible) {
        const result = results[resultIdx];
        if (result.value.id && result.value.id.equals(name))
            return { result: res, name, index: resultIdx };
    }
    return null;
}

export function makeFilterStyleDirectAnswerPhrase(ctx : ContextInfo, name : Ast.Value, filter : C.FilterSlot) : DirectAnswerPhrase|null {
    assert(C.isSameFunction(ctx.currentFunction!, filter.schema));
    const added = addSlotToBag(new SlotBag(ctx.currentFunction), filter);
    if (!added)
        return null;
    const [info,] = added;

    const results = ctx.results!;
    for (let i = 0; i < Math.min(MAX_RESULTS, results.length); i++) {
        const result = results[i];
        if (!result.value.id || !result.value.id.equals(name))
            continue;

        if (isInfoPhraseCompatibleWithResult(results[i], info)) {
            return {
                result: { ctx, info, compatible: [i] },
                name,
                index: i
            };
        }
    }

    return null;
}
