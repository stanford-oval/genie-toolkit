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

import * as argparse from 'argparse';
import assert from 'assert';
import * as fs from 'fs';
import util from 'util';
import stream from 'stream';
import seedrandom from 'seedrandom';
import * as Tp from 'thingpedia';
import { Ast, SchemaRetriever } from 'thingtalk';

import * as ParserClient from '../lib/prediction/parserclient';
import { DialogueSerializer } from '../lib/dataset-tools/parsers';
import * as StreamUtils from '../lib/utils/stream-utils';
import MultiJSONDatabase from './lib/multi_json_database';
import ProgressBar from './lib/progress_bar';
import { getBestEntityMatch } from '../lib/dialogue-agent/entity-linking/entity-finder';
import * as ThingTalkUtils from '../lib/utils/thingtalk';


const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

const SEARCH_SLOTS = new Set([
    'restaurant-name',
    'restaurant-food',
    'restaurant-area',
    'restaurant-price-range',
    'hotel-name',
    'hotel-area',
    'hotel-type',
    'hotel-price-range',
    'hotel-parking',
    'hotel-stars',
    'hotel-internet',
    'attraction-name',
    'attraction-area',
    'attraction-type',
    'train-name',
    'train-day',
    'train-departure',
    'train-destination',
    'train-leave-at',
    'train-leaveat',
    'train-arrive-by',
    'train-arriveby'
]);
const SEARCH_SLOTS_FOR_SYSTEM = new Set([
    // annotations are all over the place....
    'food', 'area',
    'price-range', 'price', 'type', 'parking',
    'internet', 'wifi', 'choice',
    'day',
    'departure', 'depart',
    'destination', 'dest',
    'leave-at', 'leave',
    'arrive-at', 'arrive',
    'stars',
]);

const REQUESTED_SLOT_MAP : Record<string, string> = {
    price: 'price_range',
    wifi: 'internet',
    leave: 'leave_at',
    arrive: 'arrive_by',
    depart: 'departure',
    dest: 'destination',
    people: 'book_people',
    time: 'book_time',
    stay: 'book_stay',
    day: 'book_day'
};


function parseTime(v : string) : Ast.TimeValue {
    if (v.indexOf('|') >= 0)
        v = v.substring(0, v.indexOf('|'));

    if (/^[0-9]+:[0-9]+/.test(v)) {
        const [hourstr, minutestr, secondstr] = v.split(':');
        let hour = parseInt(hourstr);
        const minute = parseInt(minutestr);
        let second;
        if (secondstr === undefined)
            second = 0;
        else
            second = parseInt(secondstr);
        if (hour === 24)
            hour = 0;
        return new Ast.Value.Time(new Ast.Time.Absolute(hour, minute, second));
    }

    let match = /([0-9]{2})([0-9]{2})/.exec(v);
    if (match !== null) {
        let hour = parseInt(match[1]);
        if (hour === 24)
            hour = 0;
        return new Ast.Value.Time(new Ast.Time.Absolute(hour, parseInt(match[2]), 0));
    }

    match = /([0-9]+)\s*am/.exec(v);
    if (match !== null)
        return new Ast.Value.Time(new Ast.Time.Absolute(match[1] === '12' ? 0 : parseInt(match[1]), 0, 0));

    match = /([0-9]+)\s*pm/.exec(v);
    if (match !== null)
        return new Ast.Value.Time(new Ast.Time.Absolute(match[1] === '12' ? 12 : 12 + parseInt(match[1]), 0, 0));

    // oops
    return new Ast.Value.Time(new Ast.Time.Absolute(0, 0, 0));
}

function getStatementDomain(stmt : Ast.ExpressionStatement) : string {
    return stmt.last.schema!.class!.name;
}

const USE_MANUAL_AGENT_ANNOTATION = true;

interface ConverterOptions {
    locale : string;
    timezone : string;
    thingpedia : string;
    database_file : string;
    user_nlu_server : string;
    agent_nlu_server : string;
    only_multidomain : boolean;
    use_existing : boolean;
    max_turn : number|undefined;
}

type MTODTurn = MTODUserTurn | MTODAgentTurn | MTODKnowledgeTurn;

interface MTODUserTurn {
    Agent : "User";
    Actions : Array<Record<string, string|[]>>;
    Text : string;
    active_intent : string;
    state : Record<string, Record<string, Record<string, string[]>>>;
    sanity_check : string[];
}


interface MTODAgentTurn {
    Agent : "Wizard";
    Actions : Array<Record<string, string | string[]>>;
    Text : string;
    PrimaryItem : string;
    SecondayItem : string;
    sanity_check : string[];
}


interface MTODKnowledgeTurn {
    Agent : "KnowledgeBase";
    Item : Record<string, string>;
    TotalItems : number;
    Topic : string;
}

interface Scenario {
    UserTask : string;
    WizardTask : string;
    WizardCapabilities : Array<Record<string, string>>;
    User_Goal : Record<string, Record<string, string>>;
}

interface MTODDialogue {
    Dialogue_id : string;
    Scenario : Scenario;
    Events : MTODTurn[];
}

interface ContextInfo {
    current : Ast.DialogueHistoryItem|null;
    next : Ast.DialogueHistoryItem|null;
}

class Converter extends stream.Readable {
    private _tpClient : Tp.BaseClient;
    private _schemas : SchemaRetriever;
    private _userParser : ParserClient.ParserClient;
    private _agentParser : ParserClient.ParserClient;
    private _simulatorOverrides : Map<string, string>;
    private _database : MultiJSONDatabase;
    private _simulator : ThingTalkUtils.Simulator;
    private _timezone : string;

    private _onlyMultidomain : boolean;
    private _useExisting : boolean;
    private _maxTurn : number|undefined;

    private _n : number;
    private _N : number;

    constructor(args : ConverterOptions) {
        super({ objectMode: true });
        this._onlyMultidomain = args.only_multidomain;
        this._tpClient = new Tp.FileClient(args);
        this._schemas = new SchemaRetriever(this._tpClient, null, true);
        this._userParser = ParserClient.get(args.user_nlu_server, 'en-US');
        this._agentParser = ParserClient.get(args.agent_nlu_server, 'en-US');
        this._useExisting = args.use_existing;
        this._maxTurn = args.max_turn;
        this._timezone = args.timezone;

        this._simulatorOverrides = new Map;
        const simulatorOptions : ThingTalkUtils.SimulatorOptions = {
            rng: seedrandom.alea('almond is awesome'),
            locale: 'en-US',
            timezone: args.timezone,
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas,
            overrides: this._simulatorOverrides,
            interactive: false
        };
        this._database = new MultiJSONDatabase(args.database_file);
        simulatorOptions.database = this._database;
        this._simulator = ThingTalkUtils.createSimulator(simulatorOptions);

        this._n = 0;
        this._N = 0;
    }

    _read() {}

    async start() {
        await this._database.load();
        await this._userParser.start();
        await this._agentParser.start();
    }
    async stop() {
        await this._userParser.stop();
        await this._agentParser.stop();
    }

    private async _parseUtterance(context : Ast.DialogueState|null,
                                  parser : ParserClient.ParserClient,
                                  utterance : string,
                                  forSide : 'agent'|'user',
                                  example_id : string) : Promise<Ast.DialogueState[]> {
        let contextCode, contextEntities;
        if (context !== null) {
            context = ThingTalkUtils.prepareContextForPrediction(context, forSide);
            [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(context);
        } else {
            contextCode = ['null'];
            contextEntities = {};
        }

        const parsed = await parser.sendUtterance(utterance, contextCode, contextEntities, {
            tokenized: false,
            skip_typechecking: true,
            example_id
        });
        return ThingTalkUtils.parseAllPredictions(parsed.candidates, parsed.entities, {
            timezone: this._timezone,
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas
        }) as Promise<Ast.DialogueState[]>;
    }

    private _getContextInfo(state : Ast.DialogueState) : ContextInfo {
        let next : Ast.DialogueHistoryItem|null = null,
            current : Ast.DialogueHistoryItem|null = null;
        for (let idx = 0; idx < state.history.length; idx ++) {
            const item = state.history[idx];
            if (item.results === null) {
                if (item.confirm === 'accepted')
                    next = item;
                break;
            }
            current = item;
        }

        return { current, next };
    }

    private async _doAgentTurn(context : Ast.DialogueState,
                               contextInfo : ContextInfo,
                               turn : MTODTurn,
                               agentUtterance : string,
                               exampleId : string) : Promise<Ast.DialogueState> {
        const parsedAgent = await this._parseUtterance(context, this._agentParser, agentUtterance, 'agent', exampleId);

        let agentTarget;
        if (parsedAgent.length === 0 || !(parsedAgent[0] instanceof Ast.DialogueState)) {
            // oops, bad
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_invalid', null, []);
        } else {
            agentTarget = parsedAgent[0];
        }

        if (agentTarget.dialogueAct === 'sys_propose_refined_query') {
            // this is basically never parsed right, so we override it
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_invalid', null, []);
        }

        if (this._useExisting && USE_MANUAL_AGENT_ANNOTATION) {
            // add some heuristics using the "system_acts" annotation
            // @ts-ignore
            const requestedSlots : string[] = turn.Actions.filter((act) : act is string => typeof act === 'string');
            if (requestedSlots.length > 0) {
                if (requestedSlots.some((slot) => SEARCH_SLOTS_FOR_SYSTEM.has(slot))) {
                    if (contextInfo.current && contextInfo.current.results!.results.length === 0)
                        agentTarget.dialogueAct = 'sys_empty_search_question';
                    else
                        agentTarget.dialogueAct = 'sys_search_question';
                } else {
                    if (contextInfo.current && contextInfo.current.results!.error)
                        agentTarget.dialogueAct = 'sys_action_error_question';
                    else
                        agentTarget.dialogueAct = 'sys_slot_fill';
                }

                agentTarget.dialogueActParam = requestedSlots.map((slot) => REQUESTED_SLOT_MAP[slot] || slot);
            }
        }

        // adjust to ensure the agent doesn't produce new complete statements
        agentTarget.history = agentTarget.history.filter((item) => {
            if (item.confirm === 'confirmed')
                return false;
            return !item.isExecutable() || item.confirm === 'proposed';
        });

        if (agentTarget.history.length === 0 && contextInfo.next)
            agentTarget.history.push(contextInfo.next.clone());

        return agentTarget;
    }

    private _getIDs(type : string) {
        return this._database.get(type)!.map((entry) => {
            const id : any = entry.id;
            return {
                value: id.value,
                name: id.display,
                canonical: id.display
            };
        });
    }

    private _resolveEntity(value : Ast.EntityValue) {
        const resolved = getBestEntityMatch(value.display!, value.type, this._getIDs(value.type));
        value.value = resolved.value;

        // do not override the display field, it should match the sentence instead
        // it will be overridden later when round-tripped through the executor
        //value.display = resolved.display;
    }

    private async _doUserTurn(context : Ast.DialogueState|null,
                              contextInfo : ContextInfo,
                              turn : MTODUserTurn,
                              userUtterance : string,
                              slotBag : Map<string, string[]>,
                              actionDomains : Set<string>,
                              exampleId : string) : Promise<Ast.DialogueState> {
        if (!this._useExisting) {
            // pure self-training:
            const parsedUser = await this._parseUtterance(context, this._userParser, userUtterance, 'user', exampleId);

            let userTarget;
            if (parsedUser.length === 0) {
                // oops, bad
                userTarget = new Ast.DialogueState(null, POLICY_NAME, 'invalid', null, []);
                if (contextInfo.next)
                    userTarget.history.push(contextInfo.next.clone());
            } else {
                userTarget = parsedUser[0];
            }
            // ensure that executable statements come first
            userTarget.history.sort((a, b) => {
                const aexec = a.isExecutable();
                const bexec = b.isExecutable();
                if (aexec === bexec)
                    return 0;
                if (aexec)
                    return -1;
                else
                    return 1;
            });

            return userTarget;
        }

        const allSlots = new Map<string, string[]>();

        for (const [dom_intent, slot] of Object.entries(turn.state)) {
            if (Object.keys(slot).length === 0)
                continue;

            // if (value === 'none')
            //     continue;
            for (const [name, rvs] of Object.entries(slot)) {
                const key = dom_intent + '-' + name + '-' + rvs.relation;
                allSlots.set(key, rvs.value);
            }
        }

        const newSearchSlots = new Map<string, string[]>();
        const newActionSlots = new Map<string, string[]>();
        let domain = 'empty';
        for (const [key, value] of allSlots) {
            if (slotBag.get(key) !== value) {
                slotBag.set(key, value);
                domain = key.split('-')[0];

                if (SEARCH_SLOTS.has(key))
                    newSearchSlots.set(key, value);
                else
                    newActionSlots.set(key, value);
            }
        }

        if (newSearchSlots.size === 0 && newActionSlots.size === 0) {
            // no slot given at this turn
            // parse the utterance and hope for the best...
            const parsedUser = await this._parseUtterance(context, this._userParser, userUtterance, 'user', exampleId);

            let userTarget;
            if (parsedUser.length === 0) {
                // oops, bad
                userTarget = new Ast.DialogueState(null, POLICY_NAME, 'invalid', null, []);
            } else {
                userTarget = parsedUser[0];
            }

            // remove all new info from it, copy everything over
            userTarget.history.length = 0;
            if (contextInfo.next)
                userTarget.history.push(contextInfo.next.clone());

            return userTarget;
        } else {
            const newItems = [];

            const queryname = domain[0].toUpperCase() + domain.substring(1);
            const action = queryname === 'Restaurant' ? 'make_reservation' : 'make_booking';
            const tpClass = 'mtod.' + queryname;
            const selector = new Ast.DeviceSelector(null, tpClass, null, null);

            // if the only new search slot is name, and we'll be executing the action for this
            // domain, we move the name to an action slot instead
            if (actionDomains.has(domain) && contextInfo.current && getStatementDomain(contextInfo.current.stmt) === domain) {
                const searchKeys = Array.from(newSearchSlots.keys());
                if (searchKeys.length === 1 && searchKeys[0].endsWith('name')) {
                    newActionSlots.set(searchKeys[0], newSearchSlots.get(searchKeys[0])!);
                    newSearchSlots.delete(searchKeys[0]);
                }
            }

            if (newSearchSlots.size && domain !== 'taxi') {
                const invocationTable = new Ast.InvocationExpression(null,
                    new Ast.Invocation(null, selector, queryname, [], null),
                    null);

                const filterClauses = [];
                for (let [key, old_value] of slotBag) {
                    if (!key.startsWith(domain))
                        continue;
                    if (!SEARCH_SLOTS.has(key))
                        continue;

                    let param = key.split('-').slice(1).join('_');
                    if (param === 'name')
                        param = 'id';
                    if (param === 'arriveby')
                        param = 'arrive_by';
                    if (param === 'leaveat')
                        param = 'leave_at';
                    let ttValue;

                    assert(old_value.length === 1);
                    const value = old_value[0];

                    if (value === "don't care") {
                        filterClauses.push(new Ast.BooleanExpression.DontCare(null, param));
                    } else if (['hotel', 'guesthouse'].includes(value) && key === 'hotel-type') {
                        filterClauses.push(new Ast.BooleanExpression.Atom(null, 'type', 'in_array', new Ast.Value.Array([
                            new Ast.Value.Enum('hotel'),
                            new Ast.Value.Enum('guest_house')
                        ])));
                    } else if (/^(centre|south|north|east|west)\|(centre|south|north|east|west)$/.test(value) && (key === 'restaurant-area' || key === 'attraction-area' || key === 'hotel-area')) {
                        const [, first, second] = /^(centre|south|north|east|west)\|(centre|south|north|east|west)$/.exec(value)!;
                        filterClauses.push(new Ast.BooleanExpression.Atom(null, 'area', 'in_array', new Ast.Value.Array([
                            new Ast.Value.Enum(first),
                            new Ast.Value.Enum(second)
                        ])));
                    } else if (/^(cheap|moderate|expensive)\|(cheap|moderate|expensive)$/.test(value) && (key === 'restaurant-price-range' || key === 'attraction-price-range' || key === 'hotel-price-range')) {
                        const [, first, second] = /^(cheap|moderate|expensive)\|(cheap|moderate|expensive)$/.exec(value)!;
                        filterClauses.push(new Ast.BooleanExpression.Atom(null, 'price_range', 'in_array', new Ast.Value.Array([
                            new Ast.Value.Enum(first),
                            new Ast.Value.Enum(second)
                        ])));
                    } else {
                        if (param === 'internet' || param === 'parking')
                            ttValue = new Ast.Value.Boolean(value !== 'no');
                        else if (param === 'leave_at' || param === 'arrive_by')
                            ttValue = parseTime(value);
                        else if (param === 'id' && contextInfo.current && getStatementDomain(contextInfo.current.stmt) === domain)
                            ttValue = new Ast.Value.Entity(null, tpClass + ':' + queryname, value);
                        else if (param === 'stars')
                            ttValue = new Ast.Value.Number(parseInt(value) || 0);
                        else if (param === 'area' || param === 'price_range' || param === 'day' || key === 'hotel-type')
                            ttValue = new Ast.Value.Enum(value.replace(/\s+/g, '_'));
                        else
                            ttValue = new Ast.Value.String(value);
                        if (ttValue instanceof Ast.EntityValue)
                            this._resolveEntity(ttValue);

                        let op = '==';
                        if (ttValue.isString)
                            op = '=~';
                        else if (param === 'leave_at')
                            op = '>=';
                        else if (param === 'arrive_by')
                            op = '<=';

                        filterClauses.push(new Ast.BooleanExpression.Atom(null, param, op, ttValue));
                    }
                }

                const filterTable = new Ast.FilterExpression(null, invocationTable,
                    new Ast.BooleanExpression.And(null, filterClauses), null);

                const tableStmt = new Ast.ExpressionStatement(null, filterTable);
                newItems.push(new Ast.DialogueHistoryItem(null, tableStmt, null, 'accepted'));
            }

            if (newActionSlots.size && domain !== 'attraction') {
                const invocation = new Ast.Invocation(null, selector, action, [], null);

                for (const [key, old_initvalue] of slotBag) {
                    const initvalue = old_initvalue[0];
                    if (!key.startsWith(domain))
                        continue;
                    if (SEARCH_SLOTS.has(key) && !key.endsWith('name'))
                        continue;

                    let param = key.split('-').slice(1).join('_');
                    if (param === 'name')
                        param = domain;
                    if (param === 'arriveby')
                        param = 'arrive_by';
                    if (param === 'leaveat')
                        param = 'leave_at';

                    let value = initvalue;
                    if (value === "don't care") {
                        // ???
                        // ignore
                        continue;
                    }

                    if (value.indexOf('|') >= 0)
                        value = value.substring(0, value.indexOf('|'));

                    let ttValue;
                    if (param === 'leave_at' || param === 'arrive_by' || param === 'book_time')
                        ttValue = parseTime(value);
                    else if (param === 'book_people' || param === 'book_stay')
                        ttValue = new Ast.Value.Number(parseInt(value) || 0);
                    else if (param === 'book_day' || param === 'day')
                        ttValue = new Ast.Value.Enum(value);
                    else if (param === domain)
                        ttValue = new Ast.Value.Entity(null, tpClass + ':' + queryname, value);
                    else
                        ttValue = new Ast.Value.String(value);
                    if (ttValue instanceof Ast.EntityValue)
                        this._resolveEntity(ttValue);

                    invocation.in_params.push(new Ast.InputParam(null, param, ttValue));
                }

                const actionStmt = new Ast.ExpressionStatement(null, new Ast.InvocationExpression(null, invocation, null));
                newItems.push(new Ast.DialogueHistoryItem(null, actionStmt, null, 'accepted'));
            } else if (contextInfo.next) {
                newItems.push(contextInfo.next.clone());
            }

            const userTarget = new Ast.DialogueState(null, POLICY_NAME, 'execute', null, newItems);
            await userTarget.typecheck(this._schemas);
            return userTarget;
        }
    }

    private _getActionDomains(wizardCapabilities : Array<Record<string, string>>) {
        const domains = new Set<string>();

        for (const cap of wizardCapabilities)
                domains.add(cap.Task);

        return domains;
    }


    private _extractSimulatorOverrides(utterance : string) {
        const car = /\b(black|white|red|yellow|blue|grey) (toyota|skoda|bmw|honda|ford|audi|lexus|volvo|volkswagen|tesla)\b/.exec(utterance);
        if (car)
            this._simulatorOverrides.set('car', car[0]);

        for (const token of utterance.split(' ')) {
            // a reference number is an 8 character token containing both letters and numbers
            if (token.length === 8 && /[a-z]/.test(token) && /[0-9]/.test(token))
                this._simulatorOverrides.set('reference_number', token);
        }
    }

    private async _doDialogue(dlg : MTODDialogue) {
        const id = dlg.Dialogue_id;

        const actionDomains = this._getActionDomains(dlg.Scenario.WizardCapabilities);

        let context : Ast.DialogueState|null = null, contextInfo : ContextInfo = { current: null, next: null },
            simulatorState : any = undefined;
        const slotBag = new Map<string, string[]>();
        const turns = [];
        for (let idx = 0; idx < dlg.Events.length; idx++) {
            const turn = dlg.Events[idx];
            const turnId = id + '/' + idx;

            if (this._maxTurn && idx >= this._maxTurn)
                break;

            try {
                let contextCode = '', agentUtterance = '', agentTargetCode = '';
                if (context !== null) {
                    // use the next turn to find the values of the action output parameters (reference_number and car) if any
                    this._simulatorOverrides.clear();
                    // @ts-ignore
                    agentUtterance = turn.Text;
                    this._extractSimulatorOverrides(agentUtterance);

                    // "execute" the context
                    const { newDialogueState, newExecutorState } = await this._simulator.execute(context, simulatorState);
                    context = newDialogueState;
                    simulatorState = newExecutorState;

                    for (const item of context.history) {
                        if (item.results === null)
                            continue;

                        if (item.results.results.length === 0)
                            continue;

                        const firstResult = item.results.results[0];
                        if (!firstResult.value.id)
                            continue;
                        item.results.results.sort((one, two) => {
                            const idone = one.value.id;
                            const idtwo = two.value.id;
                            if (!(idone instanceof Ast.EntityValue) ||
                                !(idtwo instanceof Ast.EntityValue))
                                return 0;
                            const onerank = agentUtterance.toLowerCase().indexOf(idone.display!.toLowerCase());
                            const tworank = agentUtterance.toLowerCase().indexOf(idtwo.display!.toLowerCase());
                            if (onerank === tworank)
                                return 0;
                            if (onerank === -1)
                                return 1;
                            if (tworank === -1)
                                return -1;
                            return onerank - tworank;
                        });
                    }
                    contextInfo = this._getContextInfo(context);
                    contextCode = context.prettyprint();

                    // do the agent
                    const agentTarget = await this._doAgentTurn(context, contextInfo, turn, agentUtterance, turnId);
                    const oldContext = context;
                    context = ThingTalkUtils.computeNewState(context, agentTarget, 'agent');
                    const prediction = ThingTalkUtils.computePrediction(oldContext, context, 'agent');
                    agentTargetCode = prediction.prettyprint();
                }

                if (turn.Agent === "Wizard" || turn.Agent === "KnowledgeBase")
                    continue;
                const userUtterance = turn.Text;
                const userTarget = await this._doUserTurn(context, contextInfo, turn, userUtterance, slotBag, actionDomains, turnId);
                const oldContext = context;
                context = ThingTalkUtils.computeNewState(context, userTarget, 'user');
                const prediction = ThingTalkUtils.computePrediction(oldContext, context, 'user');
                const userTargetCode = prediction.prettyprint();

                turns.push({
                    context: contextCode,
                    agent: agentUtterance,
                    agent_target: agentTargetCode,
                    user: userUtterance,
                    user_target: userTargetCode,
                });

                // use the next turn to find the values of the action output parameters (reference_number and car) if any
                this._simulatorOverrides.clear();
                if (idx < dlg.Events.length-1)
                    this._extractSimulatorOverrides(dlg.Events[idx+1].Agent);
            } catch(e) {
                console.error(`Failed in dialogue ${id}`);
                console.error(turn);
                throw e;
            }
        }

        this.push({ id, turns });
        this._n++;
        this.emit('progress', this._n/this._N);
    }

    async run(data : MTODDialogue[]) {
        this._n = 0;
        this._N = data.length;
        for (let i = 0; i < data.length; ) {
            // run 100 dialogues in parallel
            // Predictor will split the minibatch if necessary
            const promises = [];

            for (; i < data.length && promises.length < 1000; i++) {
                if (this._onlyMultidomain && data[i].Events.length === 1)
                    continue;

                promises.push(this._doDialogue(data[i]));
            }

            await Promise.all(promises);
        }

        this.emit('progress', 1);
        this.push(null);
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('auto-annotate-mtod', {
        add_help: true,
        description: `Heuristically convert mtod annotations to ThingTalk.`
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--database-file', {
        required: false,
        help: `Path to a file pointing to JSON databases used to simulate queries.`,
    });
    parser.add_argument('--user-nlu-server', {
        required: false,
        default: 'http://127.0.0.1:8400',
        help: `The URL of the natural language server to parse user utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
    });
    parser.add_argument('--agent-nlu-server', {
        required: false,
        default: 'http://127.0.0.1:8400',
        help: `The URL of the natural language server to parse agent utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
    });
    parser.add_argument('--only-multidomain', {
        required: false,
        action: 'store_true',
        help: 'Only translate multi-domain dialogues'
    });
    parser.add_argument('--use-existing', {
        required: false,
        action: 'store_true',
        default: true,
        help: 'Use existing annotations'
    });
    parser.add_argument('--no-use-existing', {
        required: false,
        action: 'store_false',
        dest: 'use_existing',
        help: 'Do not use existing annotations'
    });
    parser.add_argument('--max-turn', {
        required: false,
        help: 'Stop at the given turn when selftraining'
    });
    parser.add_argument('input_file', {
        help: 'Input dialog file'
    });
}

export async function execute(args : any) {
    const dataDict = JSON.parse(await util.promisify(fs.readFile)(args.input_file, { encoding: 'utf8' }));
    const data : MTODDialogue[] = Object.values(dataDict);

    const converter = new Converter(args);
    const learned = new DialogueSerializer({ annotations: true });
    const promise = StreamUtils.waitFinish(converter.pipe(learned).pipe(args.output));

    const progbar = new ProgressBar(1);
    converter.on('progress', (value) => {
        //console.log(value);
        progbar.update(value);
    });

    // issue an update now to show the progress bar
    progbar.update(0);

    await converter.start();
    await converter.run(data);
    await converter.stop();

    console.log('Finished, waiting for pending writes...');
    await promise;
    console.log('Everything done...');

    // we need this otherwise we hang at exit, due to some open file I cannot find...
    setTimeout(() => process.exit(), 10000);
}
