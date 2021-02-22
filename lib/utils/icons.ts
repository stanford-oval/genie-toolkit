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


import { Ast } from 'thingtalk';

function isPlatformBuiltin(kind : string) : boolean {
    return kind.startsWith('org.thingpedia.builtin.thingengine');
}

export function getProgramIcon(program : Ast.Input) : string|null {
    let icon : string|null = null;
    let node : Ast.Node = program;
    if (node instanceof Ast.DialogueState) {
        const last = node.history[node.history.length-1];
        if (!last)
            return null;
        node = last;
    }
    for (const [, prim] of node.iteratePrimitives(false)) {
        if (!(prim.selector instanceof Ast.DeviceSelector))
            continue;
        const newIcon = getPrimitiveIcon(prim);
        // ignore builtin/platform devices when choosing the icon
        if (!newIcon || isPlatformBuiltin(newIcon))
            continue;
        icon = newIcon;
    }
    return icon;
}

export function getPrimitiveIcon(prim : Ast.Invocation|Ast.ExternalBooleanExpression|Ast.SpecifiedPermissionFunction|null) : string|null {
    if (prim === null)
        return null;
    let kind = null;
    if (prim instanceof Ast.SpecifiedPermissionFunction)
        kind = prim.kind;
    else if (prim.selector instanceof Ast.DeviceSelector)
        kind = prim.selector.kind;

    return kind;
}
