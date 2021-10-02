// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import { ContextInfo } from '../context-info';

export interface NameList {
    ctx : ContextInfo;
    results : Ast.DialogueHistoryResultItem[];
}

export function nameListKeyFn(list : NameList) {
    const schema = list.ctx.currentFunction!;
    return {
        functionName: schema.qualifiedName,
        idType: schema.getArgType('id')!,
        length: list.results.length,

        id0: list.ctx.key.id0,
        id1: list.ctx.key.id1,
        id2: list.ctx.key.id2,
    };
}

export interface ContextName {
    ctx : ContextInfo;
    name : Ast.Value;
}

export function contextNameKeyFn(name : ContextName) {
    return {
        currentFunction: name.ctx.key.currentFunction
    };
}
