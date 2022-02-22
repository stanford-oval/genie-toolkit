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

import { Ast, } from 'thingtalk';

import * as C from '../ast_manip';

import {
    AgentReplyOptions,
    ContextInfo,
    NameList,
    makeAgentReply,
    makeSimpleState,
    addAction,
} from '../state_manip';
import {
    isInfoPhraseCompatibleWithResult,
} from './common';
import {
    SlotBag
} from '../slot_bag';
import {
    DirectAnswerPhrase
} from './results';

export interface ListProposal {
    results : Ast.DialogueHistoryResultItem[];
    info : SlotBag|null;
    action : Ast.Invocation|null;
    hasLearnMore : boolean;
}

export function listProposalKeyFn({ results, info, action, hasLearnMore } : ListProposal) {
    return {
        idType: results[0].value.id ? results[0].value.id.getType() : null,
        queryName: info ? info.schema!.qualifiedName : null,
        actionName: action ? action.schema!.qualifiedName : null,
        length: results.length
    };
}

function checkInvocationCast(x : Ast.Invocation|Ast.FunctionCallExpression) : Ast.Invocation {
    assert(x instanceof Ast.Invocation);
    return x;
}

function checkListProposal(nameList : NameList, info : SlotBag|null, hasLearnMore : boolean) : ListProposal|null {
    const { ctx, results } = nameList;
    const resultType = results[0].value.id.getType();

    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if ((last instanceof Ast.SliceExpression ||
        (last instanceof Ast.ProjectionExpression && last.expression instanceof Ast.SliceExpression)) &&
        results.length !== ctx.results!.length)
        return null;

    if (info !== null) {
        const idType = info.schema!.getArgType('id');

        if (!idType || !idType.equals(resultType))
            return null;

        const resultInfo = ctx.resultInfo!;
        if (resultInfo.projection !== null) {
            // check that all projected names are present
            for (const name of resultInfo.projection) {
                if (!info.has(name))
                    return null;
            }
        }

        // check that the filter uses the right set of parameters
        for (const result of results) {
            if (!isInfoPhraseCompatibleWithResult(result, info))
                return null;
        }
    } else {
        if (ctx.resultInfo!.projection !== null)
            return null;
    }


    const action = ctx.nextInfo && ctx.nextInfo.isAction ? checkInvocationCast(C.getInvocation(ctx.next!)) : null;
    return { results, info, action, hasLearnMore };
}

export type ThingpediaListProposal = [ContextInfo, SlotBag];

export function checkThingpediaListProposal(proposal : ThingpediaListProposal, additionalInfo : SlotBag|null) : ListProposal|null {
    const [ctx, info] = proposal;

    const resultInfo = ctx.resultInfo!;
    if (resultInfo.projection !== null) {
        // check that all projected names are present
        for (const name of resultInfo.projection) {
            if (!info.has(name))
                return null;
        }
    }

    let mergedInfo : SlotBag|null = info;
    if (additionalInfo) {
        // check that the new info is truthful
        for (const result of ctx.results!) {
            if (!isInfoPhraseCompatibleWithResult(result, additionalInfo))
                return null;
        }

        mergedInfo = SlotBag.merge(mergedInfo, additionalInfo);
    }
    if (!mergedInfo)
        return null;

    const action = ctx.nextInfo && ctx.nextInfo.isAction ? checkInvocationCast(C.getInvocation(ctx.next!)) : null;
    return { results: ctx.results!, info: mergedInfo, action, hasLearnMore: false };
}

export function makeListProposalFromDirectAnswers(...phrases : DirectAnswerPhrase[]) : ListProposal|null {
    for (let i = 0; i < phrases.length; i++) {
        if (phrases[i].index !== i)
            return null;
    }

    const ctx = phrases[0].result.ctx;

    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if ((last instanceof Ast.SliceExpression ||
        (last instanceof Ast.ProjectionExpression && last.expression instanceof Ast.SliceExpression)) &&
        phrases.length !== ctx.results!.length)
        return null;

    // check that all phrases talk about the same slots (it would be weird otherwise)
    for (let i = 1; i < phrases.length; i++) {
        for (const key of phrases[i].result.info.keys()) {
            if (!phrases[0].result.info.has(key))
                return null;
        }
        for (const key of phrases[0].result.info.keys()) {
            if (!phrases[i].result.info.has(key))
                return null;
        }
    }

    const resultInfo = ctx.resultInfo!;
    if (resultInfo.projection !== null) {
        // check that all projected names are present
        for (const name of resultInfo.projection) {
            if (!phrases[0].result.info.has(name))
                return null;
        }
    }

    // don't use a direct answer with a list if the user is issuing a query by name
    const filterTable = C.findFilterExpression(currentTable);
    if (filterTable && C.filterUsesParam(filterTable.filter, 'id'))
        return null;

    const results = ctx.results!.slice(0, phrases.length);

    return { results, info: null, action: null, hasLearnMore: false };
}

function makeListProposalReply(ctx : ContextInfo, proposal : ListProposal) {
    const { results, action, hasLearnMore } = proposal;
    const options : AgentReplyOptions = {
        numResults: results.length
    };
    if (action || hasLearnMore)
        options.end = false;
    let dialogueAct;
    switch (results.length) {
    case 2:
        dialogueAct = 'sys_recommend_two';
        break;
    case 3:
        dialogueAct = 'sys_recommend_three';
        break;
    case 4:
        dialogueAct = 'sys_recommend_four';
        break;
    default:
        dialogueAct = 'sys_recommend_many';
    }
    if (action === null)
        return makeAgentReply(ctx, makeSimpleState(ctx, dialogueAct, null), proposal, null, options);
    else
        return makeAgentReply(ctx, addAction(ctx, dialogueAct, action, 'proposed'), proposal, null, options);
}

export {
    checkListProposal,
    makeListProposalReply,
};
