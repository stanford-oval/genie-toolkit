// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Lucas Sato <satojk@cs.stanford.edu>
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

const ParserClient = require('../../../lib/prediction/parserclient');
const { DialogueSerializer } = require('../../../lib/dataset-tools/parsers');
const StreamUtils = require('../../../lib/utils/stream-utils');
const MultiJSONDatabase = require('../../lib/multi_json_database');
const ProgressBar = require('../../lib/progress_bar');
const { getBestEntityMatch } = require('../../../lib/dialogue-agent/entity-linking/entity-finder');
const { makeDate } = require('../../../languages/thingtalk/ast_manip');

const TargetLanguages = require('../../../lib/languages');
const { cleanEnumValue }  = require('./utils');

const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

// From ../../auto-annotate-multiwoz.js
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
        return new Ast.Value.Date(new Ast.DatePiece(null, null, day, null)); // FIXME, waiting on a thingtalk PR
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
    // Shouldn't get to here...
    throw 'Could not parse date: ' + v;
}

class Converter extends stream.Readable {
    constructor(args) {
        super({ objectMode: true });
        this._tpClient = new Tp.FileClient(args);
        this._schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);

        this._target = TargetLanguages.get('thingtalk');
        const simulatorOptions = {
            rng: seedrandom.alea('almond is awesome'),
            locale: 'en-US',
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas,
            forceEntityResolution: true,
        };
        this._database = new MultiJSONDatabase(args.database_file);
        simulatorOptions.database = this._database;
        this._simulator = this._target.createSimulator(simulatorOptions);
        this._schema_json_file = args.schema_json;
        this._entity_map_file = args.entity_map;
        this._entityMap = null;
        this._onlyServices = args.only_services;
    }

    _read() {}

    async start() {
        await this._database.load();
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
        if (this._entity_map_file !== undefined)
            this._entityMap = JSON.parse(await util.promisify(fs.readFile)(this._entity_map_file), { encoding: 'utf8' });
    }

    _getEntityName(slotName) {
        // Check if the given slot name is actually an entity
        // In which case it will be an id, or have a different name
        // Return null if not an entity
        for (let entity in this._entityMap) {
            if (slotName === this._entityMap[entity]['id'])
                return entity;
        }
        return null;
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

    _findSlotValue(key, frame, slotBag) {
        // we get the key from state.slot_values, but the val from selectedSlots,
        // so that we keep the canonical_values (e.g. "Italian" instead of "pasta and pizza")
        // If it's not there, then we get it from the default value in the intent schema
        // If it's not there either, we get it from the state (not canonical).
        let activeIntent = slotBag[frame.service]['activeIntent'];
        if (key in slotBag[frame.service]['selected'])
            return slotBag[frame.service]['selected'][key][0];
        else if (key in activeIntent.optional_slots)
            return activeIntent.optional_slots[key];
        else // FIXME probably a carry over slot from a different service, under a different name
            return frame.state.slot_values[key][0];
    }

    _updateSlotBag(frame, slotBag, isUserTurn) {
        if (!Object.keys(slotBag).includes(frame.service))
            slotBag[frame.service] = {'offered': {}, 'selected': {}, 'not': {}};
        for (let action of frame.actions) {
            if (action.act === 'OFFER')
                slotBag[frame.service]['offered'][action.slot] = action.canonical_values;
            if (action.act === 'SELECT') {
                if (action.slot === '') {
                    for (let slot in slotBag[frame.service]['offered'])
                        slotBag[frame.service]['selected'][slot] = slotBag[frame.service]['offered'][slot];
                    slotBag[frame.service]['offered'] = {};
                } else
                    slotBag[frame.service]['selected'][action.slot] = action.canonical_values;
            }
            if (action.act === 'REQUEST_ALTS') {
                // we want to get the entity ids and add them to the list of "rejected ids"
                for (let slot in slotBag[frame.service]['offered']) {
                    if (this._getEntityName(slot) !== null) {
                        if (slotBag[frame.service]['not'][slot] === undefined)
                            slotBag[frame.service]['not'][slot] = [];
                        slotBag[frame.service]['not'][slot] = slotBag[frame.service]['not'][slot].concat(slotBag[frame.service]['offered'][slot]);
                    }
                slotBag[frame.service]['offered'] = {};
                }
            }
            if (action.act === 'INFORM' && isUserTurn) {
                slotBag[frame.service]['selected'][action.slot] = action.canonical_values;
                // also erase the 'offered' section, since we are probably leaving it behind
                slotBag[frame.service]['offered'] = {};
            }
        }
    }

    // adapted from ./process-schema.js
    _generateValue(slot, val) {
        let entity = this._getEntityName(slot.name);
        if (entity !== null)
            return new Ast.Value.Entity(null, 'com.google.sgd:' + entity, val);
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
            if (slot.possible_values.every((v) => !isNaN(v)))
                return new Ast.Value.Number(parseInt(val) || 0);
            return new Ast.Value.Enum(cleanEnumValue(val));
        }
        if (slot.name === 'phone_number')
            return new Ast.Value.Entity(null, 'tt:phone_number', val);
        if (slot.name.startsWith('number_of_') || slot.name.endsWith('_number') || slot.name === 'number' ||
            slot.name.endsWith('_size') || slot.name === 'size' ||
            slot.name.endsWith('_rating') || slot.name === 'rating')
            return new Ast.Value.Number(parseInt(val) || 0);
        if (slot.name.endsWith('_time') || slot.name === 'time')
            return parseTime(val);
        if (slot.name.endsWith('_date') || slot.name === 'date')
            return parseDate(val.toLowerCase());
        if (slot.name.endsWith('_fare') || slot.name === 'fare' ||
            slot.name.endsWith('_price') || slot.name === 'price' ||
            ['balance', 'price_per_night', 'rent'].includes(slot.name))
            return new Ast.Value.Currency(val.value, val.code);

        return new Ast.Value.String(val);
    }

    _generateParams(frame, slotBag, intent, isQuery, isUser) {
        let params = [];
        let slot_values = isUser ? frame.state.slot_values : slotBag[frame.service]['selected'];
        for (let key in slot_values) {
            if ((!intent.required_slots.includes(key) &&
                 !Object.keys(intent.optional_slots).includes(key)))
                continue;
            let value = this._findSlotValue(key, frame, slotBag);
            if (value === 'dontcare') {
                if (isQuery)
                    params.push(new Ast.BooleanExpression.DontCare(null, key));
                continue; // actions don't take dontcares
            }

            let ttValue = this._generateValue(this._schemaObj[frame.service]['slots'][key], value);
            if (this._getEntityName(key) !== null)
                key = isQuery ? 'id' : key.replace('_name', '');
            if (ttValue.isEntity)
                this._resolveEntity(ttValue);

            let op = '==';
            if (ttValue.isString)
                op = '=~';
            if (isQuery)
                params.push(new Ast.BooleanExpression.Atom(null, key, op, ttValue));
            else
                params.push(new Ast.InputParam(null, key, ttValue));
        }
        // Now, if this is a query, there are two special cases to check for:
        // a projection on an id that was offered in the previous turn, or
        // a REQUEST_ALTS with an id in the 'not' part of slotBag
        if (isQuery) {
            let idWasOffered = false;
            if (frame.actions.map((action) => action.act).includes('REQUEST')) {
                for (let key in slotBag[frame.service]['offered']) {
                    if (this._getEntityName(key) !== null) {
                        let value = slotBag[frame.service]['offered'][key][0];
                        let ttValue = this._generateValue(this._schemaObj[frame.service]['slots'][key], value);
                        key = 'id';
                        this._resolveEntity(ttValue);
                        let op = '==';
                        params.push(new Ast.BooleanExpression.Atom(null, key, op, ttValue));
                        idWasOffered = true;
                    }
                }
            }
            if (!idWasOffered) {
                for (let key in slotBag[frame.service]['not']) { // should be an id
                    if ((!intent.required_slots.includes(key) &&
                         !Object.keys(intent.optional_slots).includes(key)))
                        continue;
                    for (let value of slotBag[frame.service]['not'][key]) {
                        let ttValue = this._generateValue(this._schemaObj[frame.service]['slots'][key], value);
                        this._resolveEntity(ttValue);
                        params.push(new Ast.BooleanExpression.Not(null, new Ast.BooleanExpression.Atom(null, 'id', '==', ttValue)));
                    }
                }
            }
        }
        return params;
    }

    async _generateProposed(context, frame, slotBag) {
        const tpClass = 'com.google.sgd';
        const selector = new Ast.Selector.Device(null, tpClass, null, null);
        let intentName = slotBag[frame.service].activeIntent.name;
        for (let action of frame.actions) {
            if (action.act === 'OFFER_INTENT')
                intentName = action.canonical_values[0];
        }
        const fullIntentName = frame.service + '_' + intentName;
        const proposedIntent = this._schemaObj[frame.service]['intents'][intentName];
        let newItems = [];
        if (proposedIntent.is_transactional) {
            // This is an action
            let in_params = this._generateParams(frame, slotBag, proposedIntent, false, false);
            const invocation = new Ast.Invocation(null, selector, fullIntentName, in_params, null);
            const statement = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, invocation, null)]);
            newItems.push(new Ast.DialogueHistoryItem(null, statement, null, 'proposed'));
        } else { // This is a query
            const invocationTable = new Ast.Table.Invocation(null,
                new Ast.Invocation(null, selector, fullIntentName, [], null),
                null);
            const filterClauses = this._generateParams(frame, slotBag, proposedIntent, true, false);
            const filterTable = filterClauses.length > 0 ?
                                new Ast.Table.Filter(null, invocationTable, new Ast.BooleanExpression.And(null, filterClauses), null) :
                                invocationTable;
            const projTable = frame.state.requested_slots.length > 0 ?
                              new Ast.Table.Projection(null, filterTable, frame.state.requested_slots, null) :
                              filterTable;
            const tableStmt = new Ast.Statement.Command(null, projTable, [new Ast.Action.Notify(null, 'notify', null)]);
            newItems.push(new Ast.DialogueHistoryItem(null, tableStmt, null, 'accepted'));
        }
        const agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_recommend_one', null, newItems);
        await agentTarget.typecheck(this._schemas);
        return agentTarget;
    }

    async _doAgentTurn(context, turn, agentUtterance, slotBag) {
        const frame = turn.frames[0]; // always only just frame with system
        let agentTarget;
        let actNames = frame.actions.map((action) => action.act);
        // first collect the offered slots in slotBag
        this._updateSlotBag(frame, slotBag, false);
        if (actNames.includes('NOTIFY_SUCCESS')) {
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_action_success', null, []);
        } else if (actNames.includes('INFORM')) {
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_recommend_one', null, []);
        } else if (actNames.includes('REQUEST')) {
            const isSearchQuestion = context.history.slice(-1).pop().stmt.table !== null;
            if (isSearchQuestion) {
                agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_search_question', null, []);
            } else {
                agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_slot_fill', null, context.history.slice(-1));
            }
            let requestActs = frame.actions.filter((action) => action.act === 'REQUEST');
            agentTarget.dialogueActParam = requestActs.map((act) => act.slot);
        } else if (actNames.includes('OFFER')) {
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_recommend_one', null, []); // maybe more than one? not sure
        } else if (actNames.includes('OFFER_INTENT') ||
                   actNames.includes('CONFIRM')) {
            agentTarget = this._generateProposed(context, frame, slotBag);
        } else if (actNames.includes('NOTIFY_FAILURE')) {
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_action_error', null, []); // Error tags get added in the doDialogue loop
        } else if (actNames.includes('REQ_MORE')) {
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_anything_else', null, []);
        } else if (actNames.includes('GOODBYE')) {
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_goodbye', null, []);
        } else {
            agentTarget = new Ast.DialogueState(null, POLICY_NAME, 'sys_invalid', null, []);
        }

        return agentTarget;
    }

    async _generateExecute(context, frame, slotBag, confirmed = false) {
        const tpClass = 'com.google.sgd';
        const selector = new Ast.Selector.Device(null, tpClass, null, null);
        const fullIntentName = frame.service + '_' + frame.state.active_intent;
        const newItems = [];
        const activeIntent = this._schemaObj[frame.service]['intents'][frame.state.active_intent];
        slotBag[frame.service].activeIntent = activeIntent;
        if (activeIntent.is_transactional) { // This is an action
            let confirmedState = (confirmed &&
                                  activeIntent.required_slots.every(val => val in frame.state.slot_values)) ?
                                 'confirmed' :
                                 'accepted';
            let in_params = this._generateParams(frame, slotBag, activeIntent, false, true);
            const invocation = new Ast.Invocation(null, selector, fullIntentName, in_params, null);
            const actionStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, invocation, null)]);
            newItems.push(new Ast.DialogueHistoryItem(null, actionStmt, null, confirmedState));
        } else {
            // This is a query
            const invocationTable = new Ast.Table.Invocation(null,
                new Ast.Invocation(null, selector, fullIntentName, [], null),
                null);
            const filterClauses = this._generateParams(frame, slotBag, activeIntent, true, true);
            const filterTable = filterClauses.length > 0 ?
                                new Ast.Table.Filter(null, invocationTable, new Ast.BooleanExpression.And(null, filterClauses), null) :
                                invocationTable;
            const projTable = frame.state.requested_slots.length > 0 ?
                              new Ast.Table.Projection(null, filterTable, frame.state.requested_slots, null) :
                              filterTable;
            const tableStmt = new Ast.Statement.Command(null, projTable, [new Ast.Action.Notify(null, 'notify', null)]);
            newItems.push(new Ast.DialogueHistoryItem(null, tableStmt, null, confirmed ? 'confirmed' : 'accepted'));
        }
        const userTarget = new Ast.DialogueState(null, POLICY_NAME, 'execute', null, newItems);
        await userTarget.typecheck(this._schemas);
        return userTarget;
    }

    async _doUserTurn(context, turn, userUtterance, slotBag) {
        let frame = turn.frames[0];
        if (turn.frames.length > 1) {
            for (let candidateFrame of turn.frames) {
                if (!['SELECT', 'NEGATE_INTENT', 'THANK_YOU'].includes(candidateFrame.actions[0].act))
                    frame = candidateFrame;
            }
        }
        let userTarget;
        let actNames = frame.actions.map((action) => action.act);
        this._updateSlotBag(frame, slotBag, true);
        if (actNames.includes('REQUEST_ALTS')) {// this should and will be overwritten if the user provides some other act, e.g. INFORM
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'ask_recommend', null, []);
        }
        if (actNames.includes('INFORM') ||
            actNames.includes('INFORM_INTENT') ||
            actNames.includes('AFFIRM_INTENT') ||
            actNames.includes('REQUEST_ALTS') ||
            actNames.includes('REQUEST')) { // execute
            userTarget = await this._generateExecute(context, frame, slotBag);
        } else if (actNames.includes('AFFIRM')) {
            userTarget = await this._generateExecute(context, frame, slotBag, true);
        } else if (actNames.includes('GOODBYE')) {
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'cancel', null, []);
        } else if (actNames.includes('THANK_YOU') ||
                   actNames.includes('REQ_MORE')) {
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'end', null, []);
        } else if (actNames.includes('NEGATE')) {
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'cancel', null, []);
        } else if (actNames.includes('SELECT')) {
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'confirm', null, []);
        } else if (!userTarget) {
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'uncaught', null, []);
        }

        return userTarget;
    }

    async _fakeError(turn, context) {
        if (!turn.frames[0].actions.map((action) => action.act).includes('NOTIFY_FAILURE'))
            return;
        let err = new Ast.Value.Enum('generic_error');
        let lastAction = context.history.pop();
        lastAction.results = new Ast.DialogueHistoryResultList(null, [], new Ast.Value.Number(0), false, err);
        context.history.push(lastAction);
    }

    async _doDialogue(dlg) {
        const id = dlg.dialogue_id;
        
        if (this._onlyServices) {
            // check if this dialogue contains only the frames we want
            for (let turn in dlg.turns) {
                for (let frame in dlg.turns[turn].frames) {
                    if (this._onlyServices.indexOf(dlg.turns[turn].frames[frame].service) < 0)
                        return null;
                }
            }
        }

        let context = null, simulatorState = undefined, slotBag = {};
        const turns = [];
        for (let idx = 0; idx < dlg.turns.length; idx = idx+2) { // NOTE: we are ignoring the last agent halfTurn
            const uHalfTurn = dlg.turns[idx];
            const aHalfTurn = dlg.turns[idx-1];

            try {
                let contextCode = '', agentUtterance = '', agentTargetCode = '';

                if (context !== null) {
                    agentUtterance = aHalfTurn.utterance.replace(/\n/g, ' '); // Some utterances are multiline
                    // "execute" the context
                    [context, simulatorState] = await this._simulator.execute(context, simulatorState);
                    // fake an action error in the last action if needed
                    await this._fakeError(aHalfTurn, context);

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
                    contextCode = context.prettyprint();

                    // do the agent
                    const agentTarget = await this._doAgentTurn(context, aHalfTurn, agentUtterance, slotBag);
                    const oldContext = context;
                    context = this._target.computeNewState(context, agentTarget, 'agent');
                    const prediction = this._target.computePrediction(oldContext, context, 'agent');
                    agentTargetCode = prediction.prettyprint();

                }

                const userUtterance = uHalfTurn.utterance.replace(/\n/g, ' ');
                const userTarget = await this._doUserTurn(context, uHalfTurn, userUtterance, slotBag);
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
        const parser = subparsers.addParser('sgd-auto-annotate', {
            addHelp: true,
            description: 'Automatically annotate SGD dataset using SGD files.'
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
        parser.addArgument('--entity-map', {
            required: false,
            help: 'Path to a JSON containing a map from entities to service methods.'
        });
        parser.addArgument('--database-file', {
            required: false,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
        });
        parser.addArgument('--schema-json', {
            required: true,
            help: `Path to the original schema.json from SGD`,
        });
        parser.addArgument('input_file', {
            help: 'Input dialog file'
        });
        parser.addArgument('--only-services', {
            required: false,
            nargs: '+',
            defaultValue: null,
            help: `Auto annotate only the services listed, if running experiment on limited domains.`
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

        console.log('Finished, waiting for pending writes...');
        await promise;
        console.log('Everything done...');

        // we need this otherwise we hang at exit, due to some open file I cannot find...
        setTimeout(() => process.exit(), 10000);
    }
};
