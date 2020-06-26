// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const stream = require('stream');
const seedrandom = require('seedrandom');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ParserClient = require('../lib/prediction/parserclient');
const { DialogueSerializer } = require('./lib/dialog_parser');
const StreamUtils = require('../lib/utils/stream-utils');
const MultiJSONDatabase = require('./lib/multi_json_database');
const ProgressBar = require('./lib/progress_bar');
const { getBestEntityMatch } = require('../lib/dialogue-agent/entity-linking/entity-finder');

function undoTradePreprocessing(sentence) {
    return sentence.replace(/ -(ly|s)/g, '$1').replace(/\b24:([0-9]{2})\b/g, '00:$1');
}

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

const REQUESTED_SLOT_MAP = {
    price: 'price_range',
    wifi: 'internet',
    leave: 'leave_at',
    arrive: 'arrive_by',
    depart: 'departure',
    dest: 'destination'
};

// copied from trade-dst
// copyright 2019 https://jasonwu0731.github.io/
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
const GENERAL_TYPO = {
    // type
    "guesthouse":"guest house", "guesthouses":"guest house", "guest":"guest house", "mutiple sports":"multiple sports",
    "sports":"multiple sports", "mutliple sports":"multiple sports","swimmingpool":"swimming pool", "concerthall":"concert hall",
    "concert":"concert hall", "pool":"swimming pool", "night club":"nightclub", "mus":"museum", "ol":"architecture",
    "colleges":"college", "coll":"college", "architectural":"architecture", "musuem":"museum", "churches":"church",
    // area
    "center":"centre", "center of town":"centre", "near city center":"centre", "in the north":"north", "cen":"centre", "east side":"east",
    "east area":"east", "west part of town":"west", "ce":"centre",  "town center":"centre", "centre of cambridge":"centre",
    "city center":"centre", "the south":"south", "scentre":"centre", "town centre":"centre", "in town":"centre", "north part of town":"north",
    "centre of town":"centre", "cb30aq": "none",
    // price
    "mode":"moderate", "moderate -ly": "moderate", "mo":"moderate",
    // day
    "next friday":"friday", "monda": "monday",
    // parking
    "free parking":"yes",
    // internet
    "free internet":"yes",
    // star
    "4 star":"4", "4 stars":"4", "0 star rarting":"none",
    // others
    "y":"yes", "any":"dontcare", "n":"no", "does not care":"dontcare", "not men":"none", "not":"none", "not mentioned":"none",
    '':"none", "not mendtioned":"none", "3 .":"3", "does not":"no", "fun":"none", "art":"none",

    // new typos
    "el shaddia guesthouse": "el shaddai"
};
function fixGeneralLabelError(key, value) {
    if (value in GENERAL_TYPO)
        value = GENERAL_TYPO[value];

    // miss match slot and value
    if ((key === "hotel-type" && ["nigh", "moderate -ly priced", "bed and breakfast", "centre", "venetian", "intern", "a cheap -er hotel"].includes(value) ||
        (key === "hotel-internet" && value === "4") ||
        (key === "hotel-price-range" && value === "2") ||
        (key === "attraction-type" && ["gastropub", "la raza", "galleria", "gallery", "science", "m"].includes(value)) ||
        (/area/.test(key) && value === "moderate") ||
        (/day/.test(key) && value === "t")))
        return 'none';

    if (key === "hotel-type" && ["hotel with free parking and free wifi", "4", "3 star hotel"].includes(value))
        return 'hotel';

    if (key === "hotel-star" && value === "3 star hotel")
        return "3";

    if (key === 'hotel-price-range' && value === '$100')
        return 'none';

    if (/area/.test(key)) {
        if (value === 'no') return "north";
        if (value === "we") return "west";
        if (value === "cent") return "centre";
    }

    return value;
}

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

function getStatementDomain(stmt) {
    if (stmt.table)
        return stmt.table.schema.class.name;
    else
        return stmt.actions[0].schema.class.name;
}

class Converter extends stream.Readable {
    constructor(args) {
        super({ objectMode: true });
        this._onlyMultidomain = args.only_multidomain;
        this._tpClient = new Tp.FileClient(args);
        this._schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);
        this._userParser = ParserClient.get(args.user_nlu_server, 'en-US');
        this._agentParser = ParserClient.get(args.agent_nlu_server, 'en-US');

        this._target = require('../lib/languages/dlgthingtalk');
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
    }

    _read() {}

    async start() {
        await this._database.load();
        await this._userParser.start();
        await this._agentParser.start();
    }
    async stop() {
        await this._userParser.start();
        await this._agentParser.start();
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

        const parsed = await parser.sendUtterance(utterance, contextCode, contextEntities);
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

    async _doAgentTurn(context, contextInfo, turn, agentUtterance) {
        const parsedAgent = await this._parseUtterance(context, this._agentParser, agentUtterance, 'agent');

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

        if (agentTarget.history.length === 0 && contextInfo.next)
            agentTarget.history.push(contextInfo.next.clone());

        return agentTarget;
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
        const resolved = getBestEntityMatch(value.display, this._getIDs(value.type));
        value.value = resolved.value;

        // do not override the display field, it should match the sentence instead
        // it will be overridden later when round-tripped through the executor
        //value.display = resolved.display;
    }

    async _doUserTurn(context, contextInfo, turn, userUtterance, slotBag, actionDomains) {
        const allSlots = new Map;

        for (let slot of turn.belief_state) {
            assert(slot.act === 'inform');

            let [key, value] = slot.slots[0];
            assert(typeof key === 'string');
            assert(typeof value === 'string');

            key = key.replace(/ /g, '-').replace(/pricerange/, 'price-range');
            value = fixGeneralLabelError(key, value);
            if (value === 'none')
                continue;
            if (/^(hospital|bus|police)-/.test(key))
                continue;

            allSlots.set(key, value);
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

        if (newSearchSlots.size === 0 && newActionSlots.size === 0) {
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
            const newItems = [];

            const queryname = domain[0].toUpperCase() + domain.substring(1);
            const action = queryname === 'Restaurant' ? 'make_reservation' : 'make_booking';
            const tpClass = 'uk.ac.cam.multiwoz.' + queryname;
            const selector = new Ast.Selector.Device(null, tpClass, null, null);

            // if the only new search slot is name, and we'll be executing the action for this
            // domain, we move the name to an action slot instead
            if (actionDomains.has(domain) && contextInfo.current && getStatementDomain(contextInfo.current.stmt) === domain) {
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
    }

    _findName(names, value) {
        for (let i = 0; i < names.length; i++) {
            let name = names[i];
            if (value.value === name.value && value.type === name.type)
                return i;
        }
        return -1;
    }

    _extractNames(dlg) {
        const names = [];

        for (let turn of dlg.dialogue) {
            for (let slot of turn.belief_state) {
                assert(slot.act === 'inform');

                let [key, value] = slot.slots[0];
                assert(typeof key === 'string');
                assert(typeof value === 'string');

                key = key.replace(/ /g, '-').replace(/pricerange/, 'price-range');
                value = fixGeneralLabelError(key, value);
                if (value === 'none' || value === 'dontcare')
                    continue;
                if (!key.endsWith('-name'))
                    continue;

                const domain = key.split('-')[0];
                const queryname = domain[0].toUpperCase() + domain.substring(1);
                const tpClass = 'uk.ac.cam.multiwoz.' + queryname;

                const ttValue = new Ast.Value.Entity(null, tpClass + ':' + queryname, value);
                this._resolveEntity(ttValue);
                const index = this._findName(names, ttValue);
                if (index < 0)
                    names.push(ttValue);
            }
        }

        return names;
    }

    _getActionDomains(dlg) {
        const domains = new Set;

        for (let turn of dlg.dialogue) {
            for (let slot of turn.belief_state) {
                assert(slot.act === 'inform');

                let [key, value] = slot.slots[0];
                assert(typeof key === 'string');
                assert(typeof value === 'string');

                key = key.replace(/ /g, '-').replace(/pricerange/, 'price-range');
                value = fixGeneralLabelError(key, value);
                if (value === 'none' || value === 'dontcare')
                    continue;
                if (SEARCH_SLOTS.has(key))
                    continue;

                const domain = key.split('-')[0];
                domains.add(domain);
            }
        }

        return domains;
    }

    _findTrainName(turn) {
        let name = undefined;
        for (let utterance of [turn.system_transcript, turn.transcript]) {
            for (let token of utterance.split(' ')) {
                if (/^tr[0-9]+$/i.test(token))
                    name = token;
            }
        }
        if (name)
            turn.belief_state.push({ slots: [ [ 'train-name', name ] ], act: 'inform' });
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

    async _doDialogue(dlg) {
        const id = dlg.dialogue_idx;

        const actionDomains = this._getActionDomains(dlg);

        let context = null, contextInfo = { current: null, next: null },
            simulatorState = undefined, slotBag = new Map;
        const turns = [];
        for (let idx = 0; idx < dlg.dialogue.length; idx++) {
            const turn = dlg.dialogue[idx];
            this._findTrainName(turn);

            try {
                let contextCode = '', agentUtterance = '', agentTargetCode = '';
                if (context !== null) {
                    // use the next turn to find the values of the action output parameters (reference_number and car) if any
                    this._simulatorOverrides.clear();
                    agentUtterance = undoTradePreprocessing(turn.system_transcript);
                    this._extractSimulatorOverrides(agentUtterance);

                    // "execute" the context
                    [context, simulatorState] = await this._simulator.execute(context, simulatorState);

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
                    const agentTarget = await this._doAgentTurn(context, contextInfo, turn, agentUtterance);
                    const oldContext = context;
                    context = this._target.computeNewState(context, agentTarget, 'agent');
                    const prediction = this._target.computePrediction(oldContext, context, 'agent');
                    agentTargetCode = prediction.prettyprint();
                }

                const userUtterance = undoTradePreprocessing(turn.transcript);
                const userTarget = await this._doUserTurn(context, contextInfo, turn, userUtterance, slotBag, actionDomains);
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
                if (idx < dlg.dialogue.length-1)
                    this._extractSimulatorOverrides(dlg.dialogue[idx+1].system_transcript);
            } catch(e) {
                console.error(`Failed in dialogue ${id}`);
                console.error(turn);
                throw e;
            }
        }

        return { id, turns };
    }

    async run(data) {
        for (let i = 0; i < data.length; i++) {
            if (this._onlyMultidomain && data[i].domains.length === 1)
                continue;

            this.push(await this._doDialogue(data[i]));
            this.emit('progress', i/data.length);
        }

        this.emit('progress', 1);
        this.push(null);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('auto-annotate-multiwoz', {
            addHelp: true,
            description: `Heuristically convert multiwoz annotations to ThingTalk.`
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--database-file', {
            required: false,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
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
        parser.addArgument('--only-multidomain', {
            required: false,
            action: 'storeTrue',
            help: 'Only translate multi-domain dialogues'
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
};
