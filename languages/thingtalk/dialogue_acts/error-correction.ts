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
// Author: Sina Semnani <sinaj@stanford.edu>


// import assert from 'assert';

import { Ast, } from 'thingtalk';

import * as C from '../ast_manip';
import * as S from '../state_manip';
// import ThingpediaLoader from '../load-thingpedia';

export function userChangeMind(ctx : S.ContextInfo, [p1, p2] : [C.ParamSlot, C.ParamSlot]) : Ast.DialogueState|null {
    // two things:
    // 1. check if the ctx is actually using p1
    const currentFunction = ctx.currentFunction;
    if (!currentFunction)
    return null; // or maybe look nextFunction
    if (!C.isSameFunction(p1.schema, currentFunction))
    return null;
    
    // return null;
    // TODO more checks here

    // 2. replace p1 with p2
    const current = ctx.current;

    const clone = current!.clone();
    // do all the modification...
    return S.addNewItem(ctx, 'execute', null, 'accepted', clone);
}
