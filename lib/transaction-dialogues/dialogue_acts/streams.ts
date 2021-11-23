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

import { Ast, } from 'thingtalk';

import * as C from '../../templates/ast_manip';
import { StateM } from '../../utils/thingtalk';

import { POLICY_NAME } from '../metadata';
import { ContextInfo } from '../context-info';

export function makeMonitor(ctx : ContextInfo, options : { monitorItemID : boolean }) {
    const currentExpression = ctx.current!.stmt.expression;
    if (currentExpression.first.schema!.functionType === 'stream')
        return null;
    const stream = C.tableToStream(currentExpression, options);
    if (!stream)
        return null;

    // throw away any planned action that we have
    return StateM.addNewStatement(ctx.state, POLICY_NAME, 'execute', [], 'accepted', stream);
}

export function addStream(ctx : ContextInfo, stream : Ast.Expression) {
    const currentExpression = ctx.current!.stmt.expression;
    if (currentExpression.first.schema!.functionType === 'stream')
        return null;

    // no self-joins
    if (C.isSameFunction(currentExpression.schema!, stream.schema!))
        return null;

    return StateM.addNewStatement(ctx.state, POLICY_NAME, 'execute', [], 'accepted',
        new Ast.ChainExpression(null, [stream, currentExpression], C.resolveChain([stream, currentExpression])));
}
