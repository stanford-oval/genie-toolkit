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
// Author: Ryan Othniel Kearns <kearns@cs.stanford.edu>
"use strict";

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const stream = require('stream');
const seedrandom = require('seedrandom');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ParserClient = require('../../lib/prediction/parserclient');
const { DialogueSerializer } = require('../../lib/dataset-tools/parsers');
const StreamUtils = require('../../lib/utils/stream-utils');
const MultiJSONDatabase = require('../lib/multi_json_database');
const ProgressBar = require('../lib/progress_bar');
const { getBestEntityMatch } = require('../../lib/dialogue-agent/entity-linking/entity-finder');
const { makeDate } = require('../../languages/thingtalk/ast_manip');

const TargetLanguages = require('../../lib/languages');
const { cleanEnumValue, SERVICE_MAP, ACTION_MAP, SLOT_MAP }  = require('./utils');

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

function getStatementDomain(stmt) {
    if (stmt.table)
        return stmt.table.schema.class.name;
    else
        return stmt.actions[0].schema.class.name;
}

// From auto-annotate-multiwoz.js
function parseTime(v) {
    if (/^[0-9]+:[0-9]+/.test(v)) {
        let [hour, minute, second] = v.split(':');
        hour = parseInt(hour);
        minute = parseInt(minute);
        if (second === undefined)
            second = 0;
        else
            second = parseInt(second);
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

function parseDate(v) {
    let now = new Date();
    let base;
    if (v.includes('today'))
        return makeDate(new Ast.DateEdge('start_of', 'day'), '+', null);
    else if (v === 'tomorrow')
        return makeDate(new Ast.DateEdge('start_of', 'day'), '+', new Ast.Value.Measure(1, 'day'))
    else if (v === 'day after tomorrow')
        return makeDate(new Ast.DateEdge('start_of', 'day'), '+', new Ast.Value.Measure(2, 'day'))
    let match = /([0-9]?[0-9]) ?(st|nd|rd|th)/.exec(v);
    if (match !== null) { // From looking at the data: it is then either "march" or "this month"
        let day = parseInt(match[1]);
        /*
        let month = v.includes('march') ? 2 : now.getMonth();
        let year = v.includes('2019') ? 2019 : now.getFullYear(); // From looking at the data, it is either 2019 or unspecified
        return new Ast.Value.Date(new Date(year, month, day));
        */
        return new Ast.Value.Date(new Ast.DatePiece('day', day)); // TODO this only works in thingtalk/wip/date-piece. Also, needs refinement, both here, as well as there
    }
    // From looking at the data, if we are still executing this function, there
    // must be at least one day of the week mentioned in the date, so we want
    // to find out which one.
    let targetDayOfWeek = 0;
    for (let dayName of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
        if (v.includes(dayName))
            break;
        targetDayOfWeek++
    }
    // Now, it's either this week (if the targetDOW is yet to come, and "next
    // week" is not specified), or it's in the next week.
    if (!v.includes('next week') && targetDayOfWeek > ((now.getDay() + 6) % 7)) { // javascript weeks begin on sunday
        return makeDate(new Ast.DateEdge('start_of', 'week'), '+',
                        new Ast.Value.Measure(targetDayOfWeek, 'day'));
    } else {
        return makeDate(new Ast.DateEdge('start_of', 'week'), '+',
                        new Ast.Value.Measure(targetDayOfWeek + 7, 'day'));
    }
}

// adapted from ./process-schema.js
function predictType(slot, val) {
    if (slot.name === 'approximate_ride_duration')
        return new Ast.Value.Measure('ms', val);
    if (slot.name === 'wind')
        return new Ast.Value.Measure('mps', val);
    if (slot.name === 'temperature')
        return new Ast.Value.Measure('C', val);
    if (['precipitation', 'humidity'].includes(slot.name))
        return new Ast.Value.Number(parseInt(val) || 0);
    if (slot.is_categorical && slot.possible_values.length > 0) {
        if (slot.possible_values.length === 2
            && slot.possible_values.includes('True')
            && slot.possible_values.includes('False'))
            return new Ast.Value.Boolean(val !== 'False');
        
        // HACK for parking and internet enums
        if (slot.possible_values.length === 3
            && slot.possible_values.includes('free')
            && slot.possible_values.includes('yes')
            && slot.possible_values.includes('no'))
            return new Ast.Value.Boolean(val !== 'no');

        if (slot.possible_values.every((v) => !isNaN(v)))
            return new Ast.Value.Number(parseInt(val) || 0);

        // HACK turn enumerated train destinations & attraction types into strings for now
        if (slot.name.endsWith('departure')
            || slot.name.endsWith('destination')
            || slot.name === 'attraction-type')
            return new Ast.Value.String(val);

        // HACK fix 'guesthouse' problem
        if (val === 'guesthouse')
            return new Ast.Value.Enum('guest_house');

        return new Ast.Value.Enum(val);
    }
    if (slot.name === 'phone_number')
        return new Ast.Value.Entity(null, 'tt:phone_number', val);
    if (slot.name.startsWith('number_of_') || slot.name.endsWith('_number') || slot.name === 'number' ||
        slot.name.endsWith('_size') || slot.name === 'size' ||
        slot.name.endsWith('_rating') || slot.name === 'rating')
        return new Ast.Value.Number(parseInt(val) || 0);
    if (slot.name.endsWith('_time') || slot.name === 'time')
        return parseTime(val);
    if (slot.name.endsWith('leaveat') || slot.name.endsWith('arriveby'))
        return parseTime(val);
    if (slot.name.endsWith('_date') || slot.name === 'date')
        return parseDate(val.toLowerCase());
    if (slot.name.endsWith('_fare') || slot.name === 'fare' ||
        slot.name.endsWith('_price') || slot.name === 'price' ||
        ['balance', 'price_per_night', 'rent'].includes(slot.name))
        return new Ast.Value.Currency(val.value, val.code);

    return new Ast.Value.String(val);
}

class Converter extends stream.Readable {
    constructor(args) {
        super({ objectMode: true });
        this._tpClient = new Tp.FileClient(args);
        this._schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);
        this._userParser = ParserClient.get(args.user_nlu_server, 'en-US');
        this._agentParser = ParserClient.get(args.agent_nlu_server, 'en-US');

        this._target = TargetLanguages.get('thingtalk');
        this._simulatorOverrides = new Map;
        const simulatorOptions = {
            rng: seedrandom.alea('almond is awesome'),
            locale: 'en-US',
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas,
            forceEntityResolution: true,
            overrides: this._simulatorOverrides
        };
        this._database = new MultiJSONDatabase(args.database_file);
        simulatorOptions.database = this._database;
        this._simulator = this._target.createSimulator(simulatorOptions);
        this._schema_json_file = args.schema_json;
    }

    _read() {}

    async start() {
        await this._database.load();
        await this._userParser.start();
        await this._agentParser.start();
        // Make map for service, slot, intent lookup
        const services = JSON.parse(await util.promisify(fs.readFile)(this._schema_json_file, { encoding: 'utf8' }));
        this._schemaObj = {};
        for (let service of services) {
            let serviceObj = {};
            let slots = {};
            for (let slot of service.slots)
                slots[slot.name] = slot;
            let intents = {};
            for (let intent of service.intents)
                intents[intent.name] = intent;
            serviceObj['slots'] = slots;
            serviceObj['intents'] = intents;
            this._schemaObj[service.service_name] = serviceObj;
        }
        console.error('succesfully started');
    }
    async stop() {
        await this._userParser.stop();
        await this._agentParser.stop();
    }


    async _parseUtterance(context, parser, utterance, forSide) {
        let contextCode, contextEntities;
        if (context !== null) {
            context = this._target.prepareContextForPrediction(context, forSide);
            [contextCode, contextEntities] = this._target.serializeNormalized(context);
        } else {
            contextCode = ['null'];
            contextEntities = {};
        }

        const parsed = await parser.sendUtterance(utterance, contextCode, contextEntities, {
            tokenized: false,
            skip_typechecking: true
        });
        return (await Promise.all(parsed.candidates.map(async (cand) => {
            try {
                const program = ThingTalk.NNSyntax.fromNN(cand.code, parsed.entities);
                await program.typecheck(this._schemas);

                // convert the program to NN syntax once, which will force the program to be syntactically normalized
                // (and therefore rearrange slot-fill by name rather than Thingpedia order)
                ThingTalk.NNSyntax.toNN(program, '', {}, { allocateEntities: true });
                return program;
            } catch(e) {
                return null;
            }
        }))).filter((c) => c !== null);
    }

    async _getContextInfo(state) {
        let next = null, current = null;
        for (let idx = 0; idx < state.history.length; idx ++) {
            const item = state.history[idx];
            if (item.results === null) {
                next = item;
                break;
            }
            current = item;
        }

        return { current, next };
    }

    _getIDs(type) {
        return this._database.get(type).map((entry) => {
            return {
                value: entry.id.value,
                name: entry.id.display,
                canonical: entry.id.display
            };
        });
    }

    _resolveEntity(value) {
        const resolved = getBestEntityMatch(value.display, value.type, this._getIDs(value.type));
        value.value = resolved.value;

        // do not override the display field, it should match the sentence instead
        // it will be overridden later when round-tripped through the executor
        //value.display = resolved.display;
    }

    async _doAgentTurn(context, contextInfo, turn, agentUtterance) {
        const parsedAgent = await this._parseUtterance(context, this._agentParser, agentUtterance.toLowerCase(), 'agent');

        let agentTarget;
        if (parsedAgent.length === 0) {
            // oops, bad
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_invalid', null, []);
        } else {
            agentTarget = parsedAgent[0];
        }

        if (agentTarget.dialogueAct === 'sys_propose_refined_query') {
            // this is basically never parsed right, so we override it
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_invalid', null, []);
        }

        /*
        // add some heuristics using the "system_acts" annotation
        const requestedSlots = turn.system_acts.filter((act) => typeof act === 'string');
        if (requestedSlots.length > 0) {
            if (requestedSlots.some((slot) => SEARCH_SLOTS_FOR_SYSTEM.has(slot))) {
                if (contextInfo.current && contextInfo.current.results.results.length === 0)
                    agentTarget.dialogueAct = 'sys_empty_search_question';
                else
                    agentTarget.dialogueAct = 'sys_search_question';
            } else {
                if (contextInfo.current && contextInfo.current.error)
                    agentTarget.dialogueAct = 'sys_action_error_question';
                else
                    agentTarget.dialogueAct = 'sys_slot_fill';
            }

            agentTarget.dialogueActParam = requestedSlots.map((slot) => REQUESTED_SLOT_MAP[slot] || slot);
        }
        */

        if (agentTarget.history.length === 0 && contextInfo.next)
            agentTarget.history.push(contextInfo.next.clone());

        return agentTarget;
    }

    async _doUserTurn(context, contextInfo, turn, selectedSlots, slotBag, trainId) {
        let userUtterance = turn['utterance'].toLowerCase();
        const allSlots = new Map;
        for (let frame of turn.frames) {
            for (let key in frame.state.slot_values) {
                let slotName = key.replace(/ /g, '-').replace(/pricerange/, 'price-range').replace(/bookpeople/, 'book-people').replace(/bookday/, 'book-day').replace(/bookstay/, 'book-stay').replace(/booktime/, 'book-time');
                let value = frame.state.slot_values[key][0].toLowerCase();
                value = value.replace(/guesthouse/, 'guest_house');
                if (/^(hospital|bus|police)-/.test(slotName))
                    continue;
                if (value === 'unknown')
                    continue;
                allSlots.set(slotName, value);
            }
        }

        const newSearchSlots = new Map;
        const newActionSlots = new Map;
        let domain = undefined;
        for (let [key, value] of allSlots) {
            if (slotBag.get(key) !== value) {
                slotBag.set(key, value);
                domain = key.split('-')[0];

                if (SEARCH_SLOTS.has(key))
                    newSearchSlots.set(key, value);
                else
                    newActionSlots.set(key, value);
            }
        }

        if (newSearchSlots.size === 0 && newActionSlots.size === 0 && (domain !== 'train' || trainId === null)) {
            // no slot given at this turn
            // parse the utterance and hope for the best...
            const parsedUser = await this._parseUtterance(context, this._userParser, userUtterance, 'user');

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
            if (domain === 'train' && trainId !== null) {
                newActionSlots.set('train-id', trainId);
                slotBag.set('train-name', trainId);
            }

            const newItems = [];

            const queryname = domain[0].toUpperCase() + domain.substring(1);
            const action = queryname === 'Restaurant' ? 'make_reservation' : 'make_booking';
            const tpClass = 'uk.ac.cam.multiwoz.' + queryname;
            const selector = new Ast.Selector.Device(null, tpClass, null, null);

            // if the only new search slot is name, and we'll be executing the action for this
            // domain, we move the name to an action slot instead
            // TODO LUCAS && actionDomains.has(domain) ?
            if (contextInfo.current && getStatementDomain(contextInfo.current.stmt) === domain) {
                const searchKeys = Array.from(newSearchSlots.keys());
                if (searchKeys.length === 1 && searchKeys[0].endsWith('name')) {
                    newActionSlots.set(searchKeys[0], newSearchSlots.get(searchKeys[0]));
                    newSearchSlots.delete(searchKeys[0]);
                }
            }

            if (newSearchSlots.size && domain !== 'taxi') {
                const invocationTable = new Ast.Table.Invocation(null,
                    new Ast.Invocation(null, selector, queryname, [], null),
                    null);

                const filterClauses = [];
                for (let [key, value] of slotBag) {
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

                    if (value === 'dontcare') {
                        filterClauses.push(new Ast.BooleanExpression.DontCare(null, param));
                    } else if (value === 'hotel|guesthouse' && key === 'hotel-type') {
                        filterClauses.push(new Ast.BooleanExpression.Atom(null, 'type', 'in_array', new Ast.Value.Array([
                            new Ast.Value.Enum('hotel'),
                            new Ast.Value.Enum('guest_house')
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
                        if (ttValue.isEntity)
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

                const filterTable = new Ast.Table.Filter(null, invocationTable,
                    new Ast.BooleanExpression.And(null, filterClauses), null);

                const tableStmt = new Ast.Statement.Command(null, filterTable, [new Ast.Action.Notify(null, 'notify', null)]);
                newItems.push(new Ast.DialogueHistoryItem(null, tableStmt, null, 'accepted'));
            }

            if (newActionSlots.size && domain !== 'attraction') {
                const invocation = new Ast.Invocation(null, selector, action, [], null);

                for (let [key, value] of slotBag) {
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

                    if (value === 'dontcare') {
                        // ???
                        // ignore
                        continue;
                    }

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
                    if (ttValue.isEntity)
                        this._resolveEntity(ttValue);

                    invocation.in_params.push(new Ast.InputParam(null, param, ttValue));
                }

                const actionStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, invocation, null)]);
                newItems.push(new Ast.DialogueHistoryItem(null, actionStmt, null, 'accepted'));
            } else if (contextInfo.next) {
                newItems.push(contextInfo.next.clone());
            }

            const userTarget = new Ast.DialogueState(null, POLICY_NAME, 'execute', null, newItems);
            await userTarget.typecheck(this._schemas);
            return userTarget;
        }
        throw 'wtf';
    }

    _extractSimulatorOverrides(utterance) {
        const car = /\b(black|white|red|yellow|blue|grey) (toyota|skoda|bmw|honda|ford|audi|lexus|volvo|volkswagen|tesla)\b/.exec(utterance);
        if (car)
            this._simulatorOverrides.set('car', car[0]);

        for (let token of utterance.split(' ')) {
            // a reference number is an 8 character token containing both letters and numbers
            if (token.length === 8 && /[a-z]/.test(token) && /[0-9]/.test(token))
                this._simulatorOverrides.set('reference_number', token);
        }
    }

    _lookForTrainId(utt, trainId) {
        let matches = utt.toLowerCase().match(/tr[0-9]{4}/ig);
        if (matches !== null)
            return matches.slice(-1).pop();
        return trainId;
    }

    async _doDialogue(dlg) {
        const id = dlg.dialogue_id;

        let context = null, contextInfo = { current: null, next: null },
            simulatorState = undefined, selectedSlots = {}, slotBag = new Map;
        const turns = [];
        // trainIds don't show up in the annotation, so we look for them in the utterances and keep track of them separately.
        let trainId = null;
        for (let idx = 0; idx < dlg.turns.length; idx = idx+2) { // NOTE: we are ignoring the last agent halfTurn
            const uHalfTurn = dlg.turns[idx];
            const aHalfTurn = dlg.turns[idx-1];

            try {
                let contextCode = '', agentUtterance = '', agentTargetCode = '';

                if (context !== null) {
                    // use the next turn to find the values of the action output parameters (reference_number and car) if any
                    this._simulatorOverrides.clear();
                    agentUtterance = aHalfTurn.utterance.replace(/\n/g, ' ').toLowerCase(); // Some utterances are multiline
                    trainId = this._lookForTrainId(agentUtterance, trainId);
                    this._extractSimulatorOverrides(agentUtterance);
                    // "execute" the context
                    [context, simulatorState] = await this._simulator.execute(context, simulatorState);
                    // fake an action error in the last action if needed
                    // await this._fakeError(aHalfTurn, context);

                    for (let item of context.history) {
                        if (item.results === null)
                            continue;

                        if (item.results.results.length === 0)
                            continue;

                        let firstResult = item.results.results[0];
                        if (!firstResult.value.id)
                            continue;
                        item.results.results.sort((one, two) => {
                            const onerank = agentUtterance.toLowerCase().indexOf(one.value.id.display.toLowerCase());
                            const tworank = agentUtterance.toLowerCase().indexOf(two.value.id.display.toLowerCase());
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
                    const agentTarget = await this._doAgentTurn(context, contextInfo, aHalfTurn, agentUtterance);
                    const oldContext = context;
                    context = this._target.computeNewState(context, agentTarget, 'agent');
                    const prediction = this._target.computePrediction(oldContext, context, 'agent');
                    agentTargetCode = prediction.prettyprint();

                }

                const userUtterance = uHalfTurn.utterance.replace(/\n/g, ' ').toLowerCase();
                trainId = this._lookForTrainId(userUtterance, trainId);
                const userTarget = await this._doUserTurn(context, contextInfo, uHalfTurn, selectedSlots, slotBag, trainId);
                const oldContext = context;
                context = this._target.computeNewState(context, userTarget, 'user');
                const prediction = this._target.computePrediction(oldContext, context, 'user');
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
                if (idx < dlg.turns.length-2)
                    this._extractSimulatorOverrides(dlg.turns[idx+2].utterance.toLowerCase());

            } catch(e) {
                console.error(`Failed in dialogue ${id}`);
                console.error(uHalfTurn);
                throw e;
            }
        }

        return { id, turns };
    }

    async run(data) {
        for (let i = 0; i < data.length; i++) {
            this.push(await this._doDialogue(data[i]));
            this.emit('progress', i/data.length);
        }

        this.emit('progress', 1);
        this.push(null);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('multiwoz-2_2-auto-annotate', {
            addHelp: true,
            description: 'Automatically convert MultiWOZ 2.2 annotations into ThingTalk format.'
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['--cache-file'], {
            required: false,
            defaultValue: './sgd_dialogues.json',
            help: 'Path to a cache file containing the schema definitions.'
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.',
        });
        parser.addArgument('--database-file', {
            required: false,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
        });
        parser.addArgument('--schema-json', {
            required: true,
            help: `Path to the original schema.json from MultiWOZ 2.2`,
        });
        parser.addArgument('--user-nlu-server', {
            required: false,
            defaultValue: 'http://127.0.0.1:8400',
            help: `The URL of the natural language server to parse user utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
        });
        parser.addArgument('--agent-nlu-server', {
            required: false,
            defaultValue: 'http://127.0.0.1:8400',
            help: `The URL of the natural language server to parse agent utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.`
        });
        parser.addArgument('input_file', {
            help: 'Input dialog file'
        });
    },

    async execute(args) {
        const data = JSON.parse(await util.promisify(fs.readFile)(args.input_file, { encoding: 'utf8' }));

        const converter = new Converter(args);
        const learned = new DialogueSerializer({ annotations: true });
        const promise = StreamUtils.waitFinish(converter.pipe(learned).pipe(args.output));

        const progbar = new ProgressBar(1);
        converter.on('progress', (value) => {
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
};
