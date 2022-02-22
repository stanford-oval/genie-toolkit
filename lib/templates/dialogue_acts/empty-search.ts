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

import * as C from '../ast_manip';

import {
    ContextInfo,
    makeAgentReply,
    makeSimpleState,
} from '../state_manip';

type EmptySearch = [Ast.Expression|null];

/**
 * Agent dialogue act: a search command returned no result.
 *
 * @param ctx - the current context
 * @param base - the base table used in the reply
 * @param question - a search question used in the reply
 */
export function makeEmptySearchError(ctx : ContextInfo, [base] : EmptySearch) {
    if (base !== null && !C.isSameFunction(base.schema!, ctx.currentTableFunction!))
        return null;

    const state = makeSimpleState(ctx, 'sys_empty_search', null);
    return makeAgentReply(ctx, state, [base]);
}
