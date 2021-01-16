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
import { Ast, } from 'thingtalk';

import { ErrorMessage } from './utils';
import { SlotBag } from './slot_bag';

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

function betaReduceMany(ast : Ast.Expression, replacements : Record<string, Ast.Value>) : Ast.Expression|null {
    const clone = ast.clone();

    for (const slot of clone.iterateSlots2({})) {
        if (slot instanceof Ast.DeviceSelector)
            continue;

        const varref = slot.get();
        if (varref instanceof Ast.VarRefValue) {
            const pname = varref.name;
            if (!(pname in replacements))
                continue;
            if (pname in slot.scope) {
                // if the parameter is in scope of the slot, it means we're in a filter and the same parameter name
                // is returned by the stream/table, which shadows the example/declaration parameter we're
                // trying to replace, hence we ignore this slot
                continue;
            }

            const replacement = replacements[pname];
            assert(replacement instanceof Ast.Value);

            // no parameter passing or undefined into device attributes
            if ((replacement.isUndefined || (replacement instanceof Ast.VarRefValue && !replacement.name.startsWith('__const')))
                && slot.tag.startsWith('attribute.'))
                return null;

            slot.set(replacement);
        }
    }
    return clone;
}

export function replacePrimitiveTemplatePlaceholdersWithConstants(ex : Ast.Example,
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

    return betaReduceMany(ex.value, replacements);
}
