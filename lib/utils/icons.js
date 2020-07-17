// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

function isPlatformBuiltin(kind) {
    return kind.startsWith('org.thingpedia.builtin.thingengine');
}

function getProgramIcon(program) {
    let icon = null;
    for (let [, prim] of program.iteratePrimitives()) {
        if (prim.selector.isBuiltin)
            continue;
        let newIcon = getPrimitiveIcon(prim);
        // ignore builtin/platform devices when choosing the icon
        if (!newIcon || isPlatformBuiltin(newIcon))
            continue;
        icon = newIcon;
    }
    return icon;
}

function getPrimitiveIcon(prim) {
    let kind;
    if (prim === null)
        return null;
    if (prim instanceof Ast.PermissionFunction)
        kind = prim.kind;
    else if (prim.selector.isDevice)
        kind = prim.selector.kind;

    if (kind && kind !== 'remote' && !kind.startsWith('__dyn')) {
        if (prim.selector && prim.selector.device)
            return prim.selector.device.kind;
        else
            return kind;
    } else {
        return null;
    }
}

module.exports = {
    getPrimitiveIcon,
    getProgramIcon
};
