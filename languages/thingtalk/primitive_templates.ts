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

import assert from 'assert';
import { Ast, Type } from 'thingtalk';

import {
    ErrorMessage,
    ParamSlot,
    ExpressionWithCoreference,
} from './utils';
import { SlotBag } from './slot_bag';

import * as C from './ast_manip';
import type ThingpediaLoader from './load-thingpedia';

// Semantic functions for primitive templates

export function replaceSlotBagPlaceholders(bag : SlotBag, names : Array<string|null>, args : Ast.Value[]) : SlotBag|null {
    const clone = bag.clone();

    assert(names.length === args.length);
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const value = args[i];

        if (name === null)
            continue;

        assert(value.isConstant());
        clone.set(name, value);
    }

    return clone;
}

export function replaceErrorMessagePlaceholders(msg : ErrorMessage, names : Array<string|null>, args : Ast.Value[]) : ErrorMessage|null {
    const newBag = replaceSlotBagPlaceholders(msg.bag, names, args);
    if (!newBag)
        return null;
    return { code: msg.code, bag: newBag };
}

export function replacePlaceholdersWithConstants(ex : Ast.Example,
                                                 names : Array<string|null>,
                                                 args : Ast.Value[]) : Ast.Expression|null {
    const replacements : Record<string, Ast.Value> = {};

    assert(names.length === args.length);
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const value = args[i];

        if (name === null)
            continue;

        assert(value.getType().equals(ex.args[name]));
        replacements[name] = value;
    }

    return C.betaReduceMany(ex.value, replacements);
}

export function replacePlaceholderWithTableOrStream(ex : Ast.Example,
                                                    names : Array<string|null>,
                                                    tableParamIdx : number,
                                                    args : Array<Ast.Value|Ast.Expression>,
                                                    tpLoader : ThingpediaLoader) : Ast.ChainExpression|null {
    // first check the table, then replace the parameters, and then finally construct the chain expression
    const table = args[tableParamIdx];
    assert(table instanceof Ast.Expression);


    const intoname = names[tableParamIdx];
    assert(typeof intoname === 'string');
    const intoType = ex.args[intoname];
    assert(intoType);
    let projection : Ast.ProjectionExpression;
    if (!(table instanceof Ast.ProjectionExpression)) {
        const maybeProjection = C.makeTypeBasedTableProjection(tpLoader, table, intoType);
        if (maybeProjection === null)
            return null;
        projection = maybeProjection;
    } else {
        projection = table;
        // FIXME we should make up a projection based on what parameter is actually passed
        if (projection.args.length !== 1)
            return null;
        if (projection.args[0] === 'id')
            return null;
    }
    assert(projection.args.length === 1);

    const joinArg = projection.args[0];
    if (joinArg === '$event' && ['p_body', 'p_message', 'p_caption', 'p_status'].indexOf(intoname) < 0)
        return null;
    const joinType = joinArg === '$event' ? Type.String : projection.schema!.getArgType(joinArg)!;

    // note: we need to use isAssignable here to get entity inheritance right
    if (!Type.isAssignable(joinType, intoType, {}, tpLoader.entitySubTypeMap))
        return null;

    const replacements : Record<string, Ast.Value> = {};
    assert(names.length === args.length);
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (name === null)
            continue;

        if (i === tableParamIdx) {
            const value = joinArg === '$event' ? new Ast.Value.Event(null) : new Ast.Value.VarRef(joinArg);
            replacements[name] = value;
        } else {
            const value = args[i] as Ast.Value;
            assert(value.getType().equals(ex.args[name]));
            replacements[name] = value;
        }
    }

    const reduced = C.betaReduceMany(ex.value, replacements);
    if (!reduced)
        return null;

    return C.makeChainExpression(projection.expression, reduced);
}

export function replacePlaceholderWithCoreference(ex : Ast.Example,
                                                  names : Array<string|null>,
                                                  corefParamIdx : number,
                                                  args : Array<Ast.Value|Ast.Expression|ParamSlot|string|undefined>) : ExpressionWithCoreference|null {

    // first perform some checks, then replace the parameters, and then finally construct
    // the expression with coreference

    // what kind of coreference are we performing
    const pname = names[corefParamIdx];
    assert(pname);
    const corefArg = args[corefParamIdx];
    let corefReplacement : Ast.Value|null = null;
    let corefSlot : ParamSlot|null = null;
    if (corefArg === undefined || typeof corefArg === 'string') {
        // generic coreference ("it", "this", etc.)
    } else if (corefArg instanceof Ast.Expression) {
        // table based coreference ("book the restaurant")
        const idArg = corefArg.schema!.getArgument('id');
        if (!idArg || !idArg.type.equals(ex.args[pname]))
            return null;
    } else {
        // param based coreference ("post the caption")
        const slot = corefArg as ParamSlot;
        if (!slot.type.equals(ex.args[pname]))
            return null;
        if (slot.name === 'id') // do not make a reference to "the name"
            return null;
        corefReplacement = new Ast.Value.VarRef(slot.name);
        corefSlot = slot;
    }

    const replacements : Record<string, Ast.Value> = {};
    assert(names.length === args.length);
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (name === null)
            continue;

        if (i === corefParamIdx) {
            if (corefReplacement !== null)
                replacements[name] = corefReplacement;
        } else {
            const value = args[i] as Ast.Value;
            assert(value.getType().equals(ex.args[name]));
            replacements[name] = value;
        }
    }

    const reduced = C.betaReduceMany(ex.value, replacements);
    if (!reduced)
        return null;

    return {
        expression: reduced,
        type: ex.args[pname],
        slot: corefSlot,
        pname: corefSlot ? null : pname
    };
}
