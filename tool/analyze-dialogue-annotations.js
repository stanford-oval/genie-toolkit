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


import assert from 'assert';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import Stream from 'stream';
import * as fs from 'fs';
import seedrandom from 'seedrandom';

import * as StreamUtils from '../lib/utils/stream-utils';
import * as ThingTalkUtils from '../lib/utils/thingtalk';
import { DialogueParser } from '../lib/dataset-tools/parsers';

import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import MultiJSONDatabase from './lib/multi_json_database';

function findFilterTable(root) {
    let table = root;
    while (!table.isFilter) {
        if (table.isSequence ||
            table.isHistory ||
            table.isWindow ||
            table.isTimeSeries)
            throw new Error('NOT IMPLEMENTED');

        // do not touch these with filters
        if (table.isAggregation ||
            table.isVarRef ||
            table.isResultRef)
            return null;

        // go inside these
        if (table.isSort ||
            table.isIndex ||
            table.isSlice ||
            table.isProjection ||
            table.isCompute ||
            table.isAlias) {
            table = table.table;
            continue;
        }

        if (table.isJoin) {
            // go right on join, always
            table = table.rhs;
            continue;
        }

        assert(table.isInvocation);
        // if we get here, there is no filter table at all
        return null;
    }

    return table;
}

const USER_DIALOGUE_ACTS = new Set([
    // user says hi!
    'greet',
    // user issues a ThingTalk program
    'execute',
    // user wants to see the result of the previous program (in reply to a generic search question)
    'ask_recommend',

    // user insists in reiterating the same search after an empty search error
    'insist',

    // user wants to see more output from the previous result
    'learn_more',

    // user asks to see an output parameter from the previous result
    'action_question',

    // user says closes the dialogue mid-way (in the middle of a search)
    'cancel',

    // user terminates the dialogue after the agent asked if there is anything
    // else the user wants
    // "end" is a terminal state, it has no continuations
    'end',
]);

const USER_STATE_MUST_HAVE_PARAM = new Set([
    'action_question'
]);

const SYSTEM_DIALOGUE_ACTS = new Set([
    // agent says hi back
    'sys_greet',
    // agent asks a question to refine a query (with or without a parameter)
    'sys_search_question',
    'sys_generic_search_question',
    // agent asks a question to slot fill a program
    'sys_slot_fill',
    // agent recommends one, two, or three results from the program (with or without an action)
    'sys_recommend_one',
    'sys_recommend_two',
    'sys_recommend_three',
    // agent proposes a refined query
    'sys_propose_refined_query',
    // agent asks the user what they would like to hear
    'sys_learn_more_what',
    // agent informs that the search is empty (with and without a slot-fill question)
    'sys_empty_search_question',
    'sys_empty_search',

    // agent executed the action successfully (and shows the result of the action)
    'sys_action_success',

    // agent had an error in executing the action (with and without a slot-fill question)
    'sys_action_error_question',
    'sys_action_error',

    // agent asks if anything else is needed
    'sys_anything_else',

    // agent says good bye
    'sys_goodbye',
]);

const SYSTEM_STATE_MUST_HAVE_PARAM = new Set([
    'sys_search_question',
    'sys_slot_fill',
    'sys_empty_search_question',
    'sys_action_error_question',
]);


function isFilterCompatibleWithResult(topResult, filter) {
    if (filter.isTrue || filter.isDontCare)
        return true;
    if (filter.isFalse)
        return false;
    if (filter.isAnd)
        return filter.operands.every((op) => isFilterCompatibleWithResult(topResult, op));
    if (filter.isOr)
        return filter.operands.some((op) => isFilterCompatibleWithResult(topResult, op));
    if (filter.isNot)
        return !isFilterCompatibleWithResult(topResult, filter.expr);

    if (filter.isExternal) // approximate
        return true;

    if (filter.isCompute) // approximate
        return true;

    const values = topResult.value;

    // if the value was not returned, assume yes
    if (!values[filter.name])
        return true;

    const resultValue = topResult.value[filter.name];

    if (resultValue.isEntity) {
        if (filter.operator === '=~')
            return resultValue.display.toLowerCase().indexOf(filter.value.toJS().toLowerCase()) >= 0;
        else
            return String(resultValue.toJS()) === String(filter.value.toJS());
    }

    switch (filter.operator) {
    case '==':
        return resultValue.toJS() === filter.value.toJS();
    case '=~':
        return String(resultValue.toJS()).toLowerCase().indexOf(String(filter.value.toJS()).toLowerCase()) >= 0;
    default:
        // approximate
        return true;
    }
}

function prettyprintStmt(stmt) {
    return new ThingTalk.Ast.Program(null, [], [], [stmt]).prettyprint();
}


class DialogueAnalyzer extends Stream.Transform {
    constructor(options) {
        super({ objectMode: true });

        this._locale = options.locale;
        this._database = options.database;

        this._options = options;
        this._debug = options.debug;

        this._simulatorOverrides = new Map;
        const simulatorOptions = {
            rng: seedrandom.alea('almond is awesome'),
            locale: options.locale,
            thingpediaClient: options.thingpediaClient,
            schemaRetriever: this._schemas,
            overrides: this._simulatorOverrides,
            database: this._database
        };

        this._simulator = ThingTalkUtils.createSimulator(simulatorOptions);
    }

    async _checkAgentTurn(turn, userCheck, previousTurn) {
        const context = await ThingTalkUtils.parse(turn.context, this._options);
        const agentTarget = await ThingTalkUtils.parse(turn.agent_target, this._options);

        if (!SYSTEM_DIALOGUE_ACTS.has(agentTarget.dialogueAct) ||
            SYSTEM_STATE_MUST_HAVE_PARAM.has(agentTarget.dialogueAct) !== (agentTarget.dialogueActParam !== null) ||
            userCheck === 'multidomain_turn')
            return 'unrepresentable';

        if (userCheck === 'unrepresentable')
            return 'unknown_user_state';

        if (turn.intermediate_context)
            return 'intermediate_context';

        if (agentTarget.history.length === 0)
            return 'ok';

        if (context.dialogueAct === 'end')
            return 'after_end';

        const previousUserTarget = await ThingTalkUtils.parse(previousTurn.user_target, this._options);
        if (previousUserTarget.history.length > 0) {
            const userLast = previousUserTarget[previousUserTarget.history.length-1];
            const contextLast = context[context.history.length-1];
            if (userLast && userLast.isExecutable() && contextLast.results === null)
                return 'added_optional';

            if (userLast && userLast.stmt.prettyprint() !== contextLast.stmt.prettyprint())
                return 'overridden_context_different_user_statement';
        }

        let current = null, currentIdx = null;
        for (let i = 0; i < context.history.length; i++) {
            const item = context.history[i];
            if (item.results === null)
                break;
            current = item;
            currentIdx = i;
        }

        if (current !== null && current.stmt.table) {
            const filterTable = findFilterTable(current.stmt.table);
            if (filterTable !== null && !current.results.results.every((result) => isFilterCompatibleWithResult(result, filterTable.filter)))
                return 'overridden_context_incompatible_filter';

            if (current.results.results.length === 0) {
                let clone = context.clone();
                clone.history[currentIdx].results = null;

                [clone,] = await await this._simulator.execute(clone, undefined /* simulator state */);
                if (clone.history[currentIdx].results.results.length > 0)
                    return 'overridden_context_wrong_empty_search';
            }
        }

        if (agentTarget.history.some((item) => item.confirm === 'proposed') &&
            !['sys_recommend_one', 'sys_recommend_two', 'sys_recommend_three', 'sys_proposed_refined_query'].includes(agentTarget.dialogueAct))
            return 'unexpected_proposed';

        if (agentTarget.dialogueActParam && agentTarget.dialogueActParam.length > 2)
            return 'multi_param_slot_fill';

        if (current && current.stmt.actions[0].isInvocation) {
            if (!['sys_action_success', 'sys_action_error_question', 'sys_action_error'].includes(agentTarget.dialogueAct))
                return 'annotation_error';
        } else {
            if (['sys_action_success', 'sys_action_error_question', 'sys_action_error'].includes(agentTarget.dialogueAct))
                return 'annotation_error';
        }

        const providedSlots = new Set;
        if (current !== null) {
            current.visit(new class extends ThingTalk.Ast.NodeVisitor {
                visitInvocation(invocation) {
                    for (let in_param of invocation.in_params) {
                        if (in_param.value.isUndefined)
                            continue;
                        providedSlots.add(in_param.name);
                    }
                    // do not recurse
                    return false;
                }

                visitDontCareBooleanExpression(expr) {
                    providedSlots.add(expr.name);
                    return false;
                }

                visitAtomBooleanExpression(expr) {
                    if (expr.value.isUndefined || expr.value.isVarRef)
                        return false;
                    providedSlots.add(expr.name);
                    return false;
                }

                visitNotBooleanExpression(expr) {
                    // explicitly do not recurse into "not" operators
                    return false;
                }

                visitOrBooleanExpression(expr) {
                    // explicitly do not recurse into "or" operators
                    return false;
                }
            });
        }
        if (['sys_search_question', 'sys_slot_fill'].includes(agentTarget.dialogueAct)) {
            for (let param of agentTarget.dialogueActParam) {
                if (providedSlots.has(param))
                    return 'redundant_slot_fill';
            }
        }

        // assume ok
        return 'ok';
    }

    _getDomain(astNode) {
        let domain = undefined;
        astNode.visit(new class extends ThingTalk.Ast.NodeVisitor {
            visitInvocation(invocation) {
                if (domain === undefined)
                    domain = invocation.selector.kind;
                else if (domain !== invocation.selector.kind)
                    domain = 'mixed';
            }
        });
        return domain;
    }

    async _checkUserTurn(turn, agentCheck) {
        let context = null;
        if (turn.intermediate_context) {
            context = await ThingTalkUtils.parse(turn.intermediate_context, this._options);
        } else if (turn.context) {
            context = await ThingTalkUtils.parse(turn.context, this._options);
            // apply the agent prediction to the context to get the state of the dialogue before
            // the user speaks
            const agentPrediction = await ThingTalkUtils.parse(turn.agent_target, this._options);
            context = ThingTalkUtils.computeNewState(context, agentPrediction);
        }
        const userTarget = await ThingTalkUtils.parse(turn.user_target, this._options);

        if (!USER_DIALOGUE_ACTS.has(userTarget.dialogueAct) ||
            USER_STATE_MUST_HAVE_PARAM.has(userTarget.dialogueAct) !== (userTarget.dialogueActParam !== null))
            return 'unrepresentable';

        if (agentCheck === 'unrepresentable')
            return 'unrepresentable_agent_state';
        if (['unrepresentable', 'unexpected_proposed', 'multi_param_slot_fill'].includes(agentCheck))
            return 'unknown_agent_state';

        if (userTarget.dialogueAct === 'execute' && userTarget.history.length === 0 &&
            !(context || context.history.length === 0))
            return 'unrepresentable'; // because the user is not saying what they want at the first turn

        const userTargetDomain = this._getDomain(userTarget);
        if (userTargetDomain === 'mixed')
            return 'multidomain_turn';

        let complex_expression = false;
        userTarget.visit(new class extends ThingTalk.Ast.NodeVisitor {
            visitAtomBooleanExpression(atom) {
                if (atom.operator === 'in_array')
                    complex_expression = true;
                return true;
            }

            visitComputationValue(value) {
                complex_expression = true;
                return true;
            }

            visitNotBooleanExpression(not) {
                // do not recurse
                return false;
            }
        });
        if (complex_expression)
            return 'complex_expression';

        let current = null, next = null;
        if (context) {
            for (let i = 0; i < context.history.length; i++) {
                const item = context.history[i];
                if (item.results === null) {
                    if (item.confirm === 'accepted')
                        next = item;
                    break;
                }
                current = item;
            }
        }

        if (current !== null && userTarget.dialogueAct === 'execute' &&
            (userTarget.history.length === 0 || prettyprintStmt(userTarget.history[0].stmt) === prettyprintStmt(current.stmt)))
            return 'reissue_identical';
        if (userTarget.dialogueAct === 'insist')
            return 'insist';

        if (next !== null && userTarget.history.every((item) => item.stmt.actions.length === 1 && item.stmt.actions.every((a) => a.isNotify))) {
            // user dropped the function
            for (let param of next.stmt.actions[0].invocation.in_params) {
                if (!param.value.isUndefined && !param.value.isEntity)
                    return 'drop_function_with_param';
            }
            return 'drop_function';
        }

        const currentDomain = context && context.history.length > 0 ? this._getDomain(context.history[context.history.length-1]) : null;
        if (currentDomain && userTargetDomain && currentDomain !== userTargetDomain &&
            !['sys_anything_else', 'sys_action_success', 'sys_action_error'].includes(context.dialogueAct))
            return 'unexpected_domain_switch';

        if (current !== null  && current.stmt.actions[0].isInvocation) {
            // after an executed action
            const actionDomain = this._getDomain(current.stmt);

            if (userTarget.history.some((item) => this._getDomain(item) === actionDomain && item.stmt.table))
                return 'query_after_action';
        }

        if (userTarget.history.length >= 2 && (next === null || prettyprintStmt(next.stmt) !== prettyprintStmt(userTarget.history[1].stmt)) &&
            context !== null  && !['sys_search_question', 'sys_generic_search_question', 'sys_anything_else', 'sys_action_success', 'sys_action_error'].includes(context.dialogueAct))
            return 'query_plus_action_refinement';

        if (userTarget.history.length === 1) {
            const item = userTarget.history[0];
            if (item.stmt.actions[0].isInvocation && !item.stmt.actions[0].invocation.in_params.some((in_param) => in_param.value.isEntity) &&
                context !== null && context.dialogueAct !== 'sys_slot_fill')
                return 'action_refinement_before_search_end';
        }

        return 'ok';
    }

    async _doDialogue(dlg) {
        let userCheck = 'ok', agentCheck = 'ok';
        for (let i = 0; i < dlg.length; i++) {
            const turn = dlg[i];
            if (i > 0)
                agentCheck = await this._checkAgentTurn(turn, userCheck, dlg[i-1]);

            userCheck = await this._checkUserTurn(turn, agentCheck);

            this.push(`${dlg.id}:${i}\t${agentCheck}\t${userCheck}\t"${turn.agent}"\t"${turn.user}"\n`);
        }
    }

    _transform(dlg, encoding, callback) {
        this._doDialogue(dlg).then(() => callback(null), callback);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('analyze-dialogue-annotations', {
        add_help: true,
        description: "Transform a dialog input file in ThingTalk format into a dialogue state tracking dataset."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--database-file', {
        required: true,
        help: `Path to a file pointing to JSON databases used to simulate queries.`,
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input dialog file; use - for standard input'
    });
    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: true
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
    parser.add_argument('--random-seed', {
        default: 'almond is awesome',
        help: 'Random seed'
    });
}

export async function execute(args) {
    let tpClient = new Tp.FileClient(args);

    const database = new MultiJSONDatabase(args.database_file);
    await database.load();

    readAllLines(args.input_file, '====')
        .pipe(new DialogueParser())
        .pipe(new DialogueAnalyzer({
            locale: args.locale,
            debug: args.debug,
            thingpediaClient: tpClient,
            database: database,
        }))
        .pipe(args.output);

    await StreamUtils.waitFinish(args.output);
}
