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
import ThingpediaLoader from '../load-thingpedia';

import {
    AgentReplyOptions,
    ContextInfo,
    NameList,
    makeAgentReply,
    makeSimpleState,
    addActionParam,
    addAction,
    addQuery,
} from '../state_manip';
import {
    isInfoPhraseCompatibleWithResult,
    findChainParam
} from './common';
import {
    queryRefinement,
    refineFilterToAnswerQuestionOrChangeFilter,
    combinePreambleAndRequest,
    proposalReply,
} from './refinement-helpers';
import {
    SlotBag
} from '../slot_bag';
import {
    DirectAnswerPhrase
} from './results';

export type ListProposal = [Ast.DialogueHistoryResultItem[], SlotBag|null, Ast.Invocation|null, boolean];

export function listProposalKeyFn([results, info, action, hasLearnMore] : ListProposal) {
    return {
        idType: results[0].value.id ? results[0].value.id.getType() : null,
        queryName: info ? info.schema!.qualifiedName : null,
        actionName: action ? action.schema!.qualifiedName : null,
    };
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


    const action = ctx.nextInfo && ctx.nextInfo.isAction ? C.getInvocation(ctx.next!) : null;
    return [results, info, action, hasLearnMore];
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

    const action = ctx.nextInfo && ctx.nextInfo.isAction ? C.getInvocation(ctx.next!) : null;
    return [ctx.results!, mergedInfo, action, false];
}

export function addActionToListProposal(nameList : NameList, action : Ast.Invocation) : ListProposal|null {
    const { ctx, results } = nameList;
    if (ctx.resultInfo!.projection !== null)
        return null;

    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const last = currentTable.last;
    if (last instanceof Ast.SliceExpression &&
        results.length !== ctx.results!.length)
        return null;

    const resultType = results[0].value.id.getType();
    if (!C.hasArgumentOfType(action, resultType))
        return null;
    const ctxAction = ctx.nextInfo && ctx.nextInfo.isAction ? C.getInvocation(ctx.next!) : null;
    if (ctxAction && !C.isSameFunction(ctxAction.schema!, action.schema!))
        return null;

    return [results, null, action, false];
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

    const names = Array.from(phrases[0].result.info.keys());
    // check that all phrases talk about the same slots (it would be weird otherwise)
    for (let i = 0; i < phrases.length; i++) {
        for (const key of phrases[i].result.info.keys()) {
            if (!names.includes(key))
                return null;
        }
        for (const name of names) {
            if (!phrases[i].result.info.has(name))
                return null;
        }
    }

    const resultInfo = ctx.resultInfo!;
    if (resultInfo.projection !== null) {
        // check that all projected names are present
        for (const phrase of phrases) {
            for (const name of resultInfo.projection) {
                if (!phrase.result.info.has(name))
                    return null;
            }
        }
    }

    // don't use a direct answer with a list if the user is issuing a query by name
    const filterTable = C.findFilterExpression(currentTable);
    if (filterTable && C.filterUsesParam(filterTable.filter, 'id'))
        return null;

    const results = ctx.results!.slice(0, phrases.length);

    return [results, null, null, false];
}

function makeListProposalReply(ctx : ContextInfo, proposal : ListProposal) {
    const [results, /*info*/, action, hasLearnMore] = proposal;
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

function positiveListProposalReply(loader : ThingpediaLoader,
                                   ctx : ContextInfo,
                                   [name, acceptedAction, mustHaveAction] : [Ast.Value, Ast.Invocation|null, boolean]) {
    // if actionProposal === null the flow is roughly
    //
    // U: hello i am looking for a restaurant
    // A: how about the ... or the ... ?
    // U: I like the ... bla
    //
    // in this case, the agent should hit the "... is a ... restaurant in the ..."
    // we treat it as "execute" dialogue act and add a filter that causes the program to return a single result

    const proposal = ctx.aux as ListProposal;
    const [results, /*info*/, actionProposal] = proposal;
    let good = false;
    for (const result of results) {
        if (result.value.id.equals(name)) {
            good = true;
            break;
        }
    }
    if (!good)
        return null;

    if (acceptedAction === null)
        acceptedAction = actionProposal;

    if (acceptedAction === null) {
        if (mustHaveAction)
            return null;

        const currentStmt = ctx.current!.stmt;
        const currentTable = currentStmt.expression;
        const namefilter = new Ast.BooleanExpression.Atom(null, 'id', '==', name);
        const newTable = queryRefinement(currentTable, namefilter, (one, two) => new Ast.BooleanExpression.And(null, [one, two]), null);
        if (newTable === null)
            return null;

        return addQuery(ctx, 'execute', newTable, 'accepted');
    } else {
        if (actionProposal !== null && !C.isSameFunction(actionProposal.schema!, acceptedAction.schema!))
            return null;

        // do not consider a phrase of the form "play X" to be "accepting the action by name"
        // if the action auto-confirms, because the user is likely playing something else
        if (acceptedAction && name) {
            const confirm = loader.ttUtils.normalizeConfirmAnnotation(acceptedAction.schema as Ast.FunctionDef);
            if (confirm === 'auto')
                return null;
        }

        const chainParam = findChainParam(results[0], acceptedAction);
        if (!chainParam)
            return null;
        return addActionParam(ctx, 'execute', acceptedAction, chainParam, name, 'accepted');
    }
}

function positiveListProposalReplyActionByName(loader : ThingpediaLoader,
                                               ctx : ContextInfo,
                                               action : Ast.Invocation) {
    const proposal = ctx.aux;
    const [results,] = proposal;

    let name = null;
    const acceptedAction = action.clone();
    const idType = results[0].value.id.getType();
    // find the chain parameter for the action, extract the name, and set the param to undefined
    // as the rest of the code expects
    for (const in_param of acceptedAction.in_params) {
        const arg = action.schema!.getArgument(in_param.name);
        assert(arg);
        if (arg.type.equals(idType)) {
            name = in_param.value;
            in_param.value = new Ast.Value.Undefined(true);
            break;
        }
    }
    if (!name)
        return null;
    return positiveListProposalReply(loader, ctx, [name, acceptedAction, false]);
}

function negativeListProposalReply(ctx : ContextInfo, [preamble, request] : [Ast.Expression|null, Ast.Expression|null]) {
    if (!((preamble === null || preamble instanceof Ast.FilterExpression) &&
          (request === null || request instanceof Ast.FilterExpression)))
        return null;

    const proposal = ctx.aux as ListProposal;
    const [results, info] = proposal;
    const proposalType = results[0].value.id.getType();
    request = combinePreambleAndRequest(preamble, request, info, proposalType);
    if (request === null)
        return null;
    return proposalReply(ctx, request, refineFilterToAnswerQuestionOrChangeFilter);
}

function listProposalLearnMoreReply(ctx : ContextInfo, name : Ast.Value) {
    // note: a learn more from a list proposal is different than a learn_more from a recommendation
    // in a recommendation, there is no change to the program, and the agent replies "what would
    // you like to know"
    // in a list proposal, we add a filter "id == "

    const proposal = ctx.aux as ListProposal;
    const [results,] = proposal;
    let good = false;
    for (const result of results) {
        if (result.value.id.equals(name)) {
            good = true;
            break;
        }
    }
    if (!good)
        return null;

    const currentStmt = ctx.current!.stmt;
    const currentTable = currentStmt.expression;
    const namefilter = new Ast.BooleanExpression.Atom(null, 'id', '==', name);
    const newTable = queryRefinement(currentTable, namefilter, (one, two) => new Ast.BooleanExpression.And(null, [one, two]), null);
    if (newTable === null)
        return null;

    return addQuery(ctx, 'execute', newTable, 'accepted');
}

export {
    checkListProposal,
    makeListProposalReply,

    positiveListProposalReply,
    positiveListProposalReplyActionByName,
    listProposalLearnMoreReply,
    negativeListProposalReply
};
