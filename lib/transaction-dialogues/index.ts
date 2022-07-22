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

import assert from 'assert';
import { Ast, Type } from 'thingtalk';

import { ContextTable, SemanticAction, UserTemplate } from '../sentence-generator/types';
import { NonTerminal } from '../sentence-generator/runtime';
import ThingpediaLoader from '../templates/load-thingpedia';
import * as C from '../templates/ast_manip';
import { StateM } from '../utils/thingtalk';
import {
    Confidence,
    DialogueInterface,
    CommandType,
    PolicyStartMode,
    UnexpectedCommandError
} from '../thingtalk-dialogues';

import * as S from './state_manip';
import * as D from './dialogue_acts';

import * as Templates from './templates/index.genie.out';
import { $load } from './templates/index.genie.out';
import { ContextInfo } from './context-info';
export {
    Templates,
    $load as initializeTemplates
};
export * from './metadata';
import { POLICY_NAME } from './metadata';
import { makeContextPhrase } from './context-phrases';
import { CancellationError } from '../dialogue-runtime';
import { addNewStatement } from '../utils/thingtalk/state-manipulation';

import followUpConfig = require('./config.json');

/**
 * This module defines the basic logic of transaction dialogues: how
 * the dialogue is started, how the agent handles each state, and how
 * the agent follows up.
 *
 * @module
 */

/**
 * Helper to create a user template from a single non-terminal, with
 * extra type-safety.
 *
 * @param nonTerm
 * @param fn
 * @returns
 */
function mkUserTmpl<T>(nonTerm : NonTerminal<T>, fn : SemanticAction<[Ast.DialogueState, T], Ast.DialogueState>) : UserTemplate {
    const name = nonTerm.name ?? nonTerm.symbol;
    const tmpl = '${' + name + '}';
    const args = { [name]: nonTerm };
    return [tmpl, args, fn];
}

function actionShouldHaveResult(ctx : ContextInfo) : boolean {
    const schema = ctx.currentFunction!;
    return C.countInputOutputParams(schema).output > 0;
}

function greet(dlg : DialogueInterface, ctx : ContextInfo) {
    dlg.say(dlg._("{hello|hi}{!|,} {how can i help you|what are you interested in|what can i do for you}?"),
        () => D.makeAgentReply(ctx, StateM.makeSimpleState(dlg.state, POLICY_NAME, 'sys_greet'), null, null, { end: false }));
    dlg.expect(function*(tpLoader : ThingpediaLoader) {
        yield mkUserTmpl(Templates.greeting, (state) => StateM.makeSimpleState(state, POLICY_NAME, 'greet'));
        yield mkUserTmpl(Templates.initial_command, (state, stmt) => D.startNewRequest(tpLoader, state, stmt));
        yield [dlg._("${greeting} ${stmt}"), {
            greeting: Templates.greeting,
            stmt: Templates.initial_command,
        }, (state : Ast.DialogueState, greeting : string, stmt : Ast.Expression) => D.startNewRequest(tpLoader, state, stmt)];
    });

    return dlg.flush();
}

async function ctxNotification(dlg : DialogueInterface, ctx : ContextInfo) {
    assert(ctx.nextInfo === null);
    assert(ctx.resultInfo, `expected result info`);

    if (ctx.resultInfo.hasError) {
        dlg.say(Templates.notification_error_preamble);
        dlg.say(Templates.action_error_phrase, (phrase) => phrase);
        return dlg.flush();
    }

    if (!ctx.resultInfo.isTable)
        return D.ctxCompletedActionSuccess(dlg, ctx, { withNotificationPreamble: true, withAnythingElse: false });

    dlg.say(Templates.notification_preamble);
    if (ctx.resultInfo.isList)
        dlg.say(Templates.system_recommendation, (proposal) => D.makeRecommendationReply(ctx, proposal));
    else
        dlg.say(Templates.system_nonlist_result, (proposal) => D.makeDisplayResultReply(ctx, proposal));
    return dlg.flush();
}


// const MAX_ENTITY_QUESTIONS = 3;
const MAX_ENTITY_QUESTIONS = followUpConfig.MAX_ENTITY_QUESTIONS;

const FOLLOWUP_PHRASE_LIST = [
    ". Will you be interested in knowing more about %s?",
    ". Do you want to know more about %s?",
    ". I think there are some other interesting stuff about %s. Would you like to know more about it?",
    ". Wanna know other news about %s?",
    ". I wonder if you would like to learn more about %s?",
    ". More news about %s?",
    ". Some more news on %s?",
    ". Feel like some more articles on %s?",
    ". Let's hear more about %s?",
    ". May I share some new articles about %s?",
    ". Perhaps more news on %s?",
    ". Want more news about %s?",
    ". How about some news on %s?",
    ". How about some news on %s next?",
    ". How about we pick some news on %s?",
    ". Shall we dig more on %s?",
    ". Shall we find more on %s?",
    ". Shall we continue with the news related to %s?",
    ". Do we continue with the stuff about %s?",
    ". Hear more about %s?",
    ". Continue the topic on %s?",
    ". Would you like to find out more about %s?",
    ". Looking for more news on %s?",
];

const POLITICAL_FOLLOWUP_PHRASE_LIST = [
    ". Will you be interested in knowing more from a different perspective?",
    ". May I share something from the %s with you?",
    ". How about we hear something from the %s side on this matter?",
    ". Will you be interested in listening to some of the articles from the %s on this topic?"
];

const NEXT_NEWS_PHRASE_LIST = [
    ". Continue with the next news?",
    ". Wanting to hear more news?",
    ". Shall we continue reading?",
    ". Looking for more news?",
    ". Do we continue reading?",
    ". How about we continue reading?"
];

const GOODBYE_PHRASE_LIST = [
    "All good, let me know if you need me.",
    "Alright, let me know if I can help you with anything else!",
    "Got it. Let me know if you need my help with anything.",
    "Very well, I will be at your service at any time.",
    "OK, give me a shout whenever you need me."
];

const POLITICS_RELATED_CATEGORIES = [
    "politic",
    "politics",
    "political",
    "policy",
    "politics policy",
    "foreign policy",
];

const CONSERVATIVE_LEANING_MEDIA_SET = new Set([
    "3abn",
    "cbn",
    "daily wire",
    "daily mail",
    "drudge report", 
    "fox news",
    "fox business",
    "fox nation",
    "national catholic register",
    "union leader",
    "new york post",
    "newsmax",
    "oan",
    "pittsburgh tribune-review",
    "pj media",
    "rsbn",
    "remnant",
    "the dispatch",
    "the first",
    "washington times",
    "wall street journal"
]);

const LIBERAL_LEANING_MEDIA_SET = new Set([
    "alternet",
    "buzzfeed",
    "cnn",
    "huffpost",
    "huffington post",
    "mother jones",
    "msnbc",
    "new york times",
    "npr",
    "the daily beast",
    "the economist",
    "the intercept",
    "the washington post",
    "vox",   
    "pbs",  
    "politico"
]);

// const NEUTRAL_MEDIA_SET = new Set([
//     "abc",
//     "bbc",
//     "bloomberg",
//     "cbs", 
//     "google",
//     "nbc news",
//     "reuters",
//     "the guardian",
//     "the hill",
//     "yahoo news",  
//     "usa today"
// ]);


function phraseGenerator(phrase_list : Array<string>, entity : Ast.StringValue|null){
    const pick = Math.floor(Math.random() * phrase_list.length);
    if (entity)
        return phrase_list[pick].replace("%s", entity.value);
    else
        return phrase_list[pick];
}

/**
 * Prompt follow-up phrases
 *
 * @param dlg - the interface to use to interact with the user
 * @param ctx - the context
 * @param keyword - associated keywords from the news article
 * @param stay_in_cateogry - whether to keep proposing articles in the same category
 * @return {boolean} - if true, 
 */
async function askNextNews(dlg : DialogueInterface, ctx : ContextInfo, keyword : Ast.Node|null, stay_in_category : boolean) {  
    let proposal_expression : any;
    let article_category : Ast.StringValue;
    // Set the category filter when invoking the Thingtalk code
    if (stay_in_category) {
        const category = ctx.results?.map((item) => item.raw && item.raw.category ? item.raw.category : [])
                                 .flat()
                                 .map((item) => String(item));
        const pick = Math.floor(Math.random() * category!.length)
        const top_category = category![pick];
        article_category = new Ast.StringValue(top_category as string);
        console.log(`picked category for the next news:`, top_category);
        if (keyword) {
            const proposal = await dlg._T`(@com.smartnews.article(keyword=${keyword}) filter contains(category, ${article_category}^^com.smartnews:category(${article_category})));`;
            assert(proposal instanceof Ast.Program);
            proposal_expression = proposal.statements[0];
            assert(proposal_expression instanceof Ast.ExpressionStatement);
        } else {
            const proposal = await dlg._T`(@com.smartnews.article() filter contains(category, ${article_category}^^com.smartnews:category(${article_category})));`;
            assert(proposal instanceof Ast.Program);
            proposal_expression = proposal.statements[0];
            assert(proposal_expression instanceof Ast.ExpressionStatement);
        }
    } else {
        const proposal = await dlg._T`@com.smartnews.article();`;
        assert(proposal instanceof Ast.Program);
        proposal_expression = proposal.statements[0];
        assert(proposal_expression instanceof Ast.ExpressionStatement);
    }

    // Prompt the follow-up message using templates and depending on the stay_in_category flag
    var next_phrase = phraseGenerator(NEXT_NEWS_PHRASE_LIST, null);
    if (stay_in_category)
        next_phrase = next_phrase.replace("?", ` in the ${article_category!.value} related category?`)
    dlg.say(dlg._("${phrase}"), {
        phrase: next_phrase
    }, () => addNewStatement(dlg.state!, POLICY_NAME, "sys_propose_refined_query", [], "proposed", proposal_expression.expression));

    // Update dialogue state
    const cmd = await dlg.get({
        expecting: Type.Boolean,
        acceptActs: ['execute', 'cancel', 'next_entity'],
        acceptQueries: ['com.smartnews.article'],
    });
    dlg.updateState();

    console.log(`cmd type`, cmd.type);

    // If user prompted cancel, break out of this loop.
    if (cmd.type === POLICY_NAME + '.cancel') {
        // break out immediately
        console.log(`got a cancel in smartnews`);
        dlg.say(phraseGenerator(GOODBYE_PHRASE_LIST, null), StateM.makeSimpleState(dlg.state, POLICY_NAME, "sys_end"));
        return false;
    }
    
    if (cmd.type !== POLICY_NAME + '.next_entity') {
        await dlg.execute(cmd.meaning);
        if (dlg.interactive && dlg.debug)
            console.log(`After execution inside SmartNews:`, dlg.state?.prettyprint());
        // alright, we executed something new, break out of this loop
        return true;
    }

    if (!stay_in_category)
        dlg.say(phraseGenerator(GOODBYE_PHRASE_LIST, null), StateM.makeSimpleState(dlg.state, POLICY_NAME, "sys_end"));
    return false;
}


/**
 * Prompt follow-up phrases
 *
 * @param dlg - the interface to use to interact with the user
 * @param ctx - the context
 * @param mentions - associated entities from the news article
 * @param entity_tracking_set - a set of entities that are already used
 * @return {number} - make recommendation if set to 1, stop recommendation by set to 0, and do nothing by set to -1s
 */
async function followUpLoop (dlg : DialogueInterface, ctx : ContextInfo, mentions: any, entity_tracking_set : Set<string>) {
    const top_category = ctx.results?.map((item) => item.raw && item.raw.category ? item.raw.category : [])
                                     .flat()
                                     .map((item) => String(item))[0];
    const article_category = new Ast.StringValue(top_category as string);
    
    // Limit the number of follow-ups to be prompted
    for (let i = 0; i < Math.min(MAX_ENTITY_QUESTIONS, mentions!.length); i++) {
        const entity_to_ask = mentions![i];
        if (entity_tracking_set.has(entity_to_ask))
            continue;
        entity_tracking_set.add(entity_to_ask);

        const entity = new Ast.StringValue(entity_to_ask as string);
        const proposal = await dlg._T`(@com.smartnews.article(keyword=${entity}) filter contains(category, ${article_category}^^com.smartnews:category(${article_category})));`;
        assert(proposal instanceof Ast.Program);
        const proposal_expression = proposal.statements[0];
        assert(proposal_expression instanceof Ast.ExpressionStatement);

        dlg.say(dlg._("${phrase}"), {
            phrase: phraseGenerator(FOLLOWUP_PHRASE_LIST, entity)
        }, () => addNewStatement(dlg.state!, POLICY_NAME, "sys_propose_refined_query", [], "proposed", proposal_expression.expression));

        const cmd = await dlg.get({
            expecting: Type.Boolean,
            acceptActs: ['execute', 'cancel', 'next_entity'],
            acceptQueries: ['com.smartnews.article'],
        });
        dlg.updateState();

        console.log(`cmd type`, cmd.type);

        if (cmd.type === POLICY_NAME + '.cancel') {
            // break out immediately
            console.log(`got a cancel in smartnews`);
            dlg.say(phraseGenerator(GOODBYE_PHRASE_LIST, null), StateM.makeSimpleState(dlg.state, POLICY_NAME, "sys_end"));
            return 0;
        }

        if (cmd.type !== POLICY_NAME + '.next_entity') {
            await dlg.execute(cmd.meaning);
            if (dlg.interactive && dlg.debug)
                console.log(`After execution inside SmartNews:`, dlg.state?.prettyprint());
            // alright, we executed something new, break out of this loop
            return 1;
        }
        // user said "no", loop to the next mention
    }
    // TODO: make random to a confidence-based deterministic value
    let pick = true;
    if (followUpConfig.RANDOM)
        pick = Math.floor(Math.random() * 4) > 0;
    const source = ctx.results![0].value.source.toJS() as string;
    console.log("source:", source);
    console.log("ask political followup?", pick);
    // For political articles. Suggest opposition opionions
    if (pick && 
        ((CONSERVATIVE_LEANING_MEDIA_SET.has(source) || (LIBERAL_LEANING_MEDIA_SET.has(source))) ||
        (POLITICS_RELATED_CATEGORIES.includes(article_category.value.toLowerCase())))) {
                    
        let opposition : Ast.StringValue;
        let proposal_expression : any;
        const entity_to_ask = mentions![0];
        const entity = new Ast.StringValue(entity_to_ask as string);
        
        if (LIBERAL_LEANING_MEDIA_SET.has(source)) {
            opposition = new Ast.StringValue("conservative media");
            console.log(`source is liberal. choose source as ${opposition.value}`)
            const keyword = new Ast.StringValue(`${entity.value}::${opposition.value}` as string)
            const proposal = await dlg._T`(@com.smartnews.article(keyword=${keyword}) filter contains(category, ${article_category}^^com.smartnews:category(${article_category})));`;
            assert(proposal instanceof Ast.Program);
            proposal_expression = proposal.statements[0];
            assert(proposal_expression instanceof Ast.ExpressionStatement);
        } else if (CONSERVATIVE_LEANING_MEDIA_SET.has(source)) {
            opposition = new Ast.StringValue("liberal media");
            console.log(`source is conservative. choose source as ${opposition.value}`)
            const keyword = new Ast.StringValue(`${entity.value}::${opposition.value}` as string)
            const proposal = await dlg._T`(@com.smartnews.article(keyword=${keyword}) filter contains(category, ${article_category}^^com.smartnews:category(${article_category})));`;
            assert(proposal instanceof Ast.Program);
            proposal_expression = proposal.statements[0];
            assert(proposal_expression instanceof Ast.ExpressionStatement);
        } else {
            console.log("non-partisian source");
            return -1;
        }

        dlg.say(dlg._("${phrase}"), {
            phrase: phraseGenerator(POLITICAL_FOLLOWUP_PHRASE_LIST, opposition)
        }, () => addNewStatement(dlg.state!, POLICY_NAME, "sys_propose_refined_query", [], "proposed", proposal_expression.expression));
    
        const cmd = await dlg.get({
            expecting: Type.Boolean,
            acceptActs: ['execute', 'cancel', 'next_entity'],
            acceptQueries: ['com.smartnews.article'],
        });
        dlg.updateState();
    
        console.log(`cmd type`, cmd.type);
    
        if (cmd.type === POLICY_NAME + '.cancel') {
            // break out immediately
            console.log(`got a cancel in smartnews`);
            dlg.say(phraseGenerator(GOODBYE_PHRASE_LIST, null), StateM.makeSimpleState(dlg.state, POLICY_NAME, "sys_end"));
            return 0;
        } else if (cmd.type !== POLICY_NAME + '.next_entity') {
            await dlg.execute(cmd.meaning);
            if (dlg.interactive && dlg.debug)
                console.log(`After execution inside SmartNews:`, dlg.state?.prettyprint());
            // alright, we executed something new, break out of this loop
            return 1;
        }
    }
    return -1;
}

/**
 * Entry point for the SmartNews Agent.
 * First, reads each article from the list.
 * When there is no more news in the list or user stops the current news list loop.
 * Suggests articles based on an associated entity/category/topic/keyword from the last article.
 *
 * @param dlg - the interface to use to interact with the user
 * @param ctx - the context
 * @param enetity_tracking_set - a set used to avoid repeating the same entities
 * @param article_tracking_set - a set used to avoid repeating the same articles
 * @return {boolean} - make recommendation if true, otherwise continue with the next news in the list
 */
async function smartNewsArticleLoop(dlg : DialogueInterface, ctx : ContextInfo, entity_tracking_set : Set<string>, article_tracking_set : Set<string>) {
    let stay_in_category = true;
    // If news list is not empty, pop the first article in the list and check if it has been read. 
    // If it has not been read (not in the article_tracking_list), add it to the article_tracking_list and break.
    // If the last article in the list has been read before, suggest other articles by entity/category/topic/keyword.
    do {
        console.log(`article_tracking_set:`, article_tracking_set);
        const id = String(ctx.results![0].value.id.toJS());
        if (article_tracking_set.has(id)) {
            console.log(`article [${id}] is already in the tracking set`)
            if (ctx.results!.length === 1) {
                console.log("no ctx results left")
                dlg.say("Sorry, there is no more news on this topic.", 
                        {}, 
                        () => StateM.makeSimpleState(dlg.state, POLICY_NAME, 'sys_recommend_one'));
                stay_in_category = false;
                return await askNextNews(dlg, ctx, null, stay_in_category);
            } else {
                ctx.results!.shift();
            }
        } else {
            article_tracking_set.add(id);
            console.log(`add to article_tracking_set:`, article_tracking_set);
            break;
        }
    } while (ctx.results!.length);

    // Get the article summary and associated entities and keywords
    const summary = ctx.results![0].value.summary;
    const mentions = ctx.results![0].value.mention?.toJS() as string[]|undefined;
    const keyword = ctx.results![0].value.keyword;
    
    // If there is no associated entity, read the summary and suggest new articles in the same cateogry
    if (!mentions || !mentions.length || ctx.results!.length === 1) {
        dlg.say("${summary}", {
            summary
        }, () => StateM.makeSimpleState(dlg.state, POLICY_NAME, 'sys_recommend_one'));
        stay_in_category = true;
        if(await askNextNews(dlg, ctx, null, stay_in_category))
            return true;
        stay_in_category = false;
        return await askNextNews(dlg, ctx, null, stay_in_category);
    }

    // If there are associated entities, read the summary and add entity to the tracking list
    dlg.say("${summary}", { summary });
    console.log(`mentioned entities`, mentions);
    if (keyword)
        entity_tracking_set.add(String(keyword));

    // Prompt follow-up questions using the entities from the current news article
    // Continue making recommendation if the return is 1
    // Stop making recommendation if the return is 0
    // Continue the conversation if the return is -1
    const loopRet = await followUpLoop(dlg, ctx, mentions, entity_tracking_set);
    if(loopRet === 0)
        return false;
    else if (loopRet === 1)
        return true

    // Continue providing the news in the same category
    // Continue making recommendation by returning true
    stay_in_category = true;
    if (await askNextNews(dlg, ctx, keyword, stay_in_category))
        return true;

    // Propose articles from different category if there is no more news in the same category
    // Continue making recommendation by returning true
    stay_in_category = false;
    if (await askNextNews(dlg, ctx, keyword, stay_in_category))
        return true;
    // dlg.say("Is there anything else you want to hear?", StateM.makeSimpleState(dlg.state, POLICY_NAME, "sys_end"));
    // dlg.say(phraseGenerator(GOODBYE_PHRASE_LIST, null), StateM.makeSimpleState(dlg.state, POLICY_NAME, "sys_end"));
    return false;
}

/**
 * Entry point for the SmartNews if the context is related to SmartNews
 *
 * @param dlg the interface to use to interact with the user
 */
async function ctxSmartNews(dlg : DialogueInterface) {
    const entity_tracking_set = new Set<string>();
    const article_tracking_set = new Set<string>();

    for (;;) {
        // Get the context based on what the user said
        const ctx = ContextInfo.get(dlg.state);

        // 
        if (ctx.results!.length === 0) {
            dlg.say("sorry, there is no more news related to that topic.", StateM.makeSimpleState(dlg.state, POLICY_NAME, "sys_end"));
            return dlg.flush();
        }
        // Check if the agent is set to ask follow-ups. If yes,  
        if (followUpConfig.ASK_FOLLOWUPS) {
            if (!await smartNewsArticleLoop(dlg, ctx, entity_tracking_set, article_tracking_set))
                return dlg.flush();
        } else {
            dlg.say(Templates.system_list_proposal, (list) => D.makeListProposalReply(ctx, list));
            return dlg.flush();
        }
    }
}

async function ctxCompleteSearchCommand(dlg : DialogueInterface, ctx : ContextInfo) {
    if (ctx.results!.length > 1) {
        return dlg.either([
            async () => {
                dlg.say(Templates.system_list_proposal, (list) => D.makeListProposalReply(ctx, list));
            },
            async () => {
                dlg.say(Templates.system_recommendation, (rec) => D.makeRecommendationReply(ctx, rec));
            },
        ]);
    } else {
        return dlg.either([
            async () => {
                dlg.say(Templates.system_recommendation, (rec) => D.makeRecommendationReply(ctx, rec));
            },
        ]);
    }
}

async function ctxIncompleteSearchCommand(dlg : DialogueInterface, ctx : ContextInfo) {
    if (ctx.results!.length > 1) {
        return dlg.either([
            async () => {
                dlg.say(Templates.system_list_proposal, (list) => D.makeListProposalReply(ctx, list));
            },
            async () => {
                dlg.say(Templates.system_recommendation, (rec) => D.makeRecommendationReply(ctx, rec));
            },
            async () => {
                dlg.say(Templates.search_question, (questions) => D.makeSearchQuestion(ctx, questions));
            },
            async () => {
                dlg.say(Templates.system_generic_proposal, (prop) => prop);
            },
        ]);
    } else {
        return dlg.either([
            async () => {
                dlg.say(Templates.system_recommendation, (rec) => D.makeRecommendationReply(ctx, rec));
            },
            async () => {
                dlg.say(Templates.search_question, (questions) => D.makeSearchQuestion(ctx, questions));
            },
            async () => {
                dlg.say(Templates.system_generic_proposal, (prop) => prop);
            },
        ]);
    }
}

async function ctxExecute(dlg : DialogueInterface, ctx : ContextInfo) : Promise<D.AgentReplyRecord|null> {
    // treat an empty execute like greet
    if (ctx.state.history.length === 0)
        return greet(dlg, ContextInfo.initial());

    if (ctx.nextInfo !== null) {
        // we have an action we want to execute, or a query that needs confirmation
        if (ctx.nextInfo.chainParameter === null || ctx.nextInfo.chainParameterFilled) {
            // we don't need to fill any parameter from the current query
            if (ctx.nextInfo.isComplete) {
                // we have all the parameters but we didn't execute: we need to confirm
                dlg.say(Templates.action_confirm_phrase, (phrase) => phrase);
            } else {
                // we are missing some parameter
                dlg.say(Templates.slot_fill_question_for_action, (questions) => D.makeSlotFillQuestion(ctx, questions));
            }
            return dlg.flush();
        }
    }

    // we must have a result
    assert(ctx.resultInfo, `expected result info`);
    if (ctx.resultInfo.hasError) {
        dlg.say(Templates.action_error_phrase, (phrase) => phrase);
        return dlg.flush();
    }
    if (ctx.resultInfo.hasStream) {
        dlg.say(dlg._("${preamble} I {will|am going to} ${stmt}"), {
            preamble: Templates.generic_excitement_phrase,
            stmt: new NonTerminal('ctx_current_statement')
        }, () => D.makeAgentReply(ctx, StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_rule_enable_success')));
        return dlg.flush();
    }

    if (!ctx.resultInfo.isTable) {
        if (ctx.resultInfo.hasEmptyResult && actionShouldHaveResult(ctx)) {
            dlg.say(Templates.empty_search_error, (error) => D.makeEmptySearchError(ctx, error));
            return dlg.flush();
        } else {
            return D.ctxCompletedActionSuccess(dlg, ctx);
        }
    }

    if (ctx.currentFunction!.qualifiedName === 'com.smartnews.article')
        return ctxSmartNews(dlg);

    if (ctx.resultInfo.hasEmptyResult) {
        // note: aggregation cannot be empty (it would be zero)
        dlg.say(Templates.empty_search_error, (error) => D.makeEmptySearchError(ctx, error));
        return dlg.flush();
    }

    if (!ctx.resultInfo.isList) {
        if (ctx.results!.length === 1)
            dlg.say(Templates.system_nonlist_result, (result) => D.makeDisplayResultReply(ctx, result));
        else
            dlg.say(Templates.system_list_proposal, (result) => D.makeDisplayResultReplyFromList(ctx, result));
        return dlg.flush();
    } else if (ctx.resultInfo.isQuestion) {
        if (ctx.resultInfo.isAggregation) {
            // "how many restaurants nearby have more than 500 reviews?"
            return D.ctxAggregationQuestion(dlg, ctx);
        } else if (ctx.resultInfo.argMinMaxField !== null) {
            // these are treated as single result questions, but
            // the context is tagged as ctx_with_result_argminmax instead of
            // ctx_with_result_noquestion
            // so the answer is worded differently
            return ctxCompleteSearchCommand(dlg, ctx);
        } else if (ctx.resultInfo.hasSingleResult) {
            // "what is the rating of Terun?"
            // FIXME if we want to answer differently, we need to change this one
            return ctxCompleteSearchCommand(dlg, ctx);
        } else if (ctx.resultInfo.hasLargeResult) {
            // "what's the food and price range of restaurants nearby?"
            // we treat these the same as "find restaurants nearby", but we make sure
            // that the necessary fields are computed
            return ctxCompleteSearchCommand(dlg, ctx);
            // return ctxIncompleteSearchCommand(dlg, ctx);
        } else {
            // "what's the food and price range of restaurants nearby?"
            // we treat these the same as "find restaurants nearby", but we make sure
            // that the necessary fields are computed
            return ctxCompleteSearchCommand(dlg, ctx);
        }
    } else {
        if (ctx.resultInfo.hasSingleResult) {
            // we can recommend
            return ctxCompleteSearchCommand(dlg, ctx);
        } else if (ctx.resultInfo.hasLargeResult && ctx.state.dialogueAct !== 'ask_recommend') {
            // we can refine
            return ctxIncompleteSearchCommand(dlg, ctx);
        } else {
            return ctxCompleteSearchCommand(dlg, ctx);
        }
    }
}

/**
 * The main entrypoint of the dialogue.
 *
 * @param dlg the interface to use to interact with the user
 */
export async function policy(dlg : DialogueInterface, startMode : PolicyStartMode) {
    // TODO call "expect" here a bunch of times to register the templates
    dlg.expectAlways(function*() {
        yield mkUserTmpl(Templates.thanks_phrase, (state) => StateM.makeSimpleState(state, POLICY_NAME, 'cancel'));
    });

    if (dlg.interactive && dlg.debug)
        console.log('Policy start');
    let lastReply : D.AgentReplyRecord|null = null;
    switch (startMode) {
        case PolicyStartMode.NORMAL:
            lastReply = await greet(dlg, ContextInfo.initial());
            break;
        case PolicyStartMode.NO_WELCOME:
            break;
        case PolicyStartMode.RESUME:
            // nothing to do, just wait for the next command
            break;
        case PolicyStartMode.USER_FIRST_TIME:
            throw new Error(`first time for the user`);
            break;
    }

    for (;;) {
        try {
            const cmd = await dlg.get({
                expecting: lastReply?.expecting,
                rawHandler: lastReply?.raw ? ((cmd, loader) => interpretAnswer(dlg.state, new Ast.StringValue(cmd), loader)) : undefined,

                acceptActs: ['*'],
                acceptQueries: ['*'],
                acceptActions: ['*']
            });
            dlg.updateState();

            if (cmd.confidence === Confidence.LOW) {
                const yesNo = await dlg.ask(dlg._("Did you mean ${command}?"), {
                    command: new NonTerminal('ctx_next_statement')
                }, 'sys_confirm_parse', null, Type.Boolean);
                assert(yesNo instanceof Ast.BooleanValue);
                if (!yesNo.value) {
                    dlg.say(dlg._("Sorry I couldn't help on that."),
                        StateM.makeSimpleState(dlg.state, POLICY_NAME, 'sys_end'));
                    return;
                }
            }

            // execute the command immediately regardless of dialogue act
            // this will update dlg.state to the dialogue state after the user speaks
            await dlg.execute(cmd.meaning);
            if (dlg.interactive && dlg.debug)
                console.log(`After execution:`, dlg.state?.prettyprint());
            const ctx = ContextInfo.get(dlg.state);

            switch (cmd.type) {
                case POLICY_NAME + '.end':{
                    dlg.say(dlg._("alright, {bye|good bye}!"), StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_end'));
                    return;
                }
                case POLICY_NAME + '.greet':
                case POLICY_NAME + '.reinit': {
                    lastReply = await greet(dlg, ctx);
                    break;
                }
                case POLICY_NAME + '.action_question': {
                    lastReply = await D.ctxCompletedActionSuccess(dlg, ctx);
                    break;
                }
                case POLICY_NAME + '.learn_more':{
                    dlg.say(Templates.system_learn_more, () => D.makeAgentReply(ctx, StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_learn_more_what'), null, null, { end: false }));
                    lastReply = await dlg.flush();
                    break;
                }
                case POLICY_NAME + '.cancel':{
                    if (dlg.flags.anything_else)
                        dlg.say(Templates.anything_else_phrase, () => StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_end'));
                    else
                        dlg.say(dlg._("alright, let me know if I can help you with anything else!"), StateM.makeSimpleState(ctx.state, POLICY_NAME, 'sys_end'));
                    return;
                }
                case POLICY_NAME + '.notification':{
                    lastReply = await ctxNotification(dlg, ctx);
                    break;
                }
                case POLICY_NAME + '.init':
                case POLICY_NAME + '.insist':
                case POLICY_NAME + '.execute':
                case POLICY_NAME + '.ask_recommend':
                case CommandType.THINGTALK_ACTION:
                case CommandType.THINGTALK_QUERY:
                case CommandType.THINGTALK_STREAM:{
                    lastReply = await ctxExecute(dlg, ctx);
                    break;
                }
                default:
                    throw new Error(`Unexpected user dialogue act ${ctx.state.dialogueAct}`);
            }
        } catch(e) {
            // catch legacy cancellation errors coming from dlg.execute()
            if (e instanceof CancellationError) {
                dlg.say('', StateM.makeSimpleState(dlg.state, POLICY_NAME, 'sys_end'));
                return;
            }

            if (!(e instanceof UnexpectedCommandError))
                throw e;

            dlg.say(dlg._("Sorry, I did not understand that. Can you rephrase it?"), StateM.makeSimpleState(dlg.state, POLICY_NAME, 'sys_unexpected'));
            lastReply = await dlg.flush();
        }
    }
}

/**
 * Extract all the relevant context phrases for the given state.
 *
 * The context phrases will be used to generate the agent reply,
 * and are mapped to the context non-terminals defined in templates/index.genie.
 */
export function getContextPhrasesForState(state : Ast.DialogueState|null,
                                          tpLoader : ThingpediaLoader,
                                          contextTable : ContextTable) {
    if (state === null)
        return [makeContextPhrase(contextTable.ctx_init, ContextInfo.initial())];

    assert(state instanceof Ast.DialogueState, `expected a dialogue state Ast node`);
    if (state.policy !== POLICY_NAME)
        return [];
    const ctx = ContextInfo.get(state);
    return S.getAgentContextPhrases(ctx, tpLoader, contextTable);
}

/**
 * Handle answers generated from the UI.
 *
 * This function converts the answer to the appropriate dialogue state at this turn,
 * if possible, or returns `null` to signal failure.
 */
export function interpretAnswer(state : Ast.DialogueState|null,
                                answer : Ast.Value,
                                tpLoader : ThingpediaLoader) : Ast.DialogueState|null {
    if (!state)
        return null;

    const ctx = ContextInfo.get(state);
    // if the agent proposed something and the user says "yes", we accept the proposal
    if (state.history.length > 0 && state.history[state.history.length-1].confirm === 'proposed'
        && answer instanceof Ast.BooleanValue) {
        if (answer.value) {
            // yes accepts
            return D.acceptAllProposedStatements(state);
        } else {
            // no is "next_entity" in smartnews
            if (ctx.currentFunction?.qualifiedName === 'com.smartnews.article')
                return StateM.makeSimpleState(state, POLICY_NAME, 'next_entity');

            // no is cancel otherwise
            return StateM.makeSimpleState(state, POLICY_NAME, 'cancel');
        }
    }

    switch (state.dialogueAct) {
    case 'sys_record_command':
        return StateM.makeSimpleState(state, POLICY_NAME, 'end');

    case 'sys_anything_else':
        if (answer instanceof Ast.BooleanValue) {
            if (answer.value)
                return StateM.makeSimpleState(state, POLICY_NAME, 'reinit');
            else
                return StateM.makeSimpleState(state, POLICY_NAME, 'end');
        }
        return null;
    case 'sys_recommend_one':
    case 'sys_recommend_two':
    case 'sys_recommend_three':
    case 'sys_recommend_four':
        // "yes" to a recommendation (without a proposed action) is an answer to
        // "would you like to learn more"
        if (answer instanceof Ast.BooleanValue && answer.value === true)
            return StateM.makeSimpleState(state, POLICY_NAME, 'learn_more');
        // fallthrough
    case 'sys_display_result':
        // "no" to a recommendation or display result is cancel
        if (answer instanceof Ast.BooleanValue && answer.value === false)
            return StateM.makeSimpleState(state, POLICY_NAME, 'cancel');
        return null;

    case 'sys_slot_fill':
        return D.impreciseSlotFillAnswer(ctx, tpLoader, answer);
    case 'sys_search_question':
        return D.impreciseSearchQuestionAnswer(ctx, tpLoader, answer);
    case 'sys_confirm_action':
        if (answer instanceof Ast.BooleanValue) {
            if (answer.value)
                return D.actionConfirmAcceptPhrase(ctx);
            else
                return D.actionConfirmRejectPhrase(ctx);
        }
        return null;
    case 'sys_confirm_parse':
    case 'sys_resolve_contact':
    case 'sys_resolve_device':
    case 'sys_ask_phone_number':
    case 'sys_ask_email_address':
    case 'sys_resolve_location':
    case 'sys_resolve_time':
    case 'sys_configure_notifications':
        return StateM.makeSimpleState(state, POLICY_NAME, 'answer', [answer]);
    default:
        return null;
    }
}

/**
 * Handle notifications.
 *
 * This function prepares a dialogue state suitable for displaying a notification.
 */
export function notification(appName : string|null, program : Ast.Program, result : Ast.DialogueHistoryResultItem) {
    assert(program.statements.length === 1);
    const stmt = program.statements[0];
    assert(stmt instanceof Ast.ExpressionStatement);

    return new Ast.DialogueState(null, POLICY_NAME, 'notification', appName ? [new Ast.Value.String(appName)] : null,
        [new Ast.DialogueHistoryItem(null, stmt, new Ast.DialogueHistoryResultList(null, [result], new Ast.NumberValue(1), false), 'confirmed')]);
}

export function notifyError(appName : string|null, program : Ast.Program, error : Ast.Value) {
    assert(program.statements.length === 1);
    const stmt = program.statements[0];
    assert(stmt instanceof Ast.ExpressionStatement);

    return new Ast.DialogueState(null, POLICY_NAME, 'notification', appName ? [new Ast.Value.String(appName)] : null,
        [new Ast.DialogueHistoryItem(null, stmt, new Ast.DialogueHistoryResultList(null, [], new Ast.NumberValue(0), false, error), 'confirmed')]);
}

/**
 * Compute the initial state of the dialogue.
 */
export function initialState(tpLoader : ThingpediaLoader) {
    const initialFunction = tpLoader.initialFunction;
    if (!initialFunction)
        return null;

    const selector = new Ast.DeviceSelector(null, initialFunction.class!.name, null, null, []);
    const invocation = new Ast.Invocation(null, selector, initialFunction.name, [], initialFunction);
    // add required arguments to the invocation, or we'll fail to notice this statement is not executable
    for (const arg of initialFunction.iterateArguments()) {
        if (arg.is_input && arg.required)
            invocation.in_params.push(new Ast.InputParam(null, arg.name, new Ast.Value.Undefined(true)));
    }

    const stmt = new Ast.ExpressionStatement(null, new Ast.InvocationExpression(null,
        invocation, initialFunction));
    return new Ast.DialogueState(null, POLICY_NAME, 'init', null, [new Ast.DialogueHistoryItem(null, stmt, null, 'accepted')]);
}

/**
 * Compute a possible agent follow up to the given state.
 *
 * @deprecated This function is bad and needs to be refactored out.
 */
export function getFollowUp(state : Ast.DialogueState,
                            tpLoader : ThingpediaLoader,
                            contextTable : ContextTable) {
    const ctx = ContextInfo.get(state);
    if (ctx.next)
        return null;

    const current = ctx.current;
    if (!current)
        return null;

    if (current.stmt.stream)
        return null;

    const currentfunction = current.stmt.expression.schema!;
    const followUp = tpLoader.getFollowUp(currentfunction.qualifiedName);
    if (!followUp)
        return null;

    const selector = new Ast.DeviceSelector(null, followUp.schema.class!.name, null, null, []);
    const invocation = new Ast.Invocation(null, selector, followUp.schema.name, [], followUp.schema);

    const idArg = currentfunction.getArgument('id');
    const results = ctx.results!;
    const topResult = results.length > 0 ? results[0] : undefined;
    const action = C.getInvocation(current);

    if (followUp.condition) {
        let value : Ast.Value|undefined;
        if (topResult) {
            value = topResult.value[followUp.condition.name];
        } else {
            for (const param of action.in_params) {
                if (param.name === followUp.condition.name) {
                    value = param.value;
                    break;
                }
            }
        }
        if (!value)
            return null;
        if (String(value.toJS()) !== followUp.condition.value)
            return null;
    }

    const setArguments = new Set<string>();
    if (followUp.params.length > 0) {
        // find another statement with the same function and copy over the arguments we're asked to copy
        for (let idx = ctx.currentIdx!; idx >= 0; idx --) {
            const item = ctx.state.history[idx];
            if (C.isSameFunction(item.stmt.expression.schema!, followUp.schema)) {
                const action = C.getInvocation(item);
                for (const in_param of action.in_params) {
                    if (followUp.params.includes(in_param.name)) {
                        invocation.in_params.push(in_param);
                        setArguments.add(in_param.name);
                    }
                }

                break;
            }
        }
    }

    for (const followUpArg of followUp.schema.iterateArguments()) {
        if (!followUpArg.is_input)
            continue;
        if (setArguments.has(followUpArg.name))
            continue;
        if (idArg && topResult && topResult.value.id && followUpArg.type.equals(idArg.type))
            invocation.in_params.push(new Ast.InputParam(null, followUpArg.name, topResult.value.id));
        else if (followUpArg.required)
            invocation.in_params.push(new Ast.InputParam(null, followUpArg.name, new Ast.UndefinedValue(true)));
    }

    return StateM.addNewStatement(ctx.state, POLICY_NAME, 'execute', [], 'accepted', new Ast.InvocationExpression(null,
        invocation, followUp.schema));
}
