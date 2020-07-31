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
    // Shouldn't get to here...
    throw 'Could not parse date: ' + v;
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
    }

    async _generateProposed(context, frame, selectedSlots) {
        const tpClass = 'com.google.sgd';
        const selector = new Ast.Selector.Device(null, tpClass, null, null);
        let intentName = selectedSlots[frame.service].activeIntent.name;
        for (let action of frame.actions) {
            if (action.act === 'OFFER_INTENT')
                intentName = action.canonical_values[0];
        }
        const fullIntentName = frame.service + '_' + intentName;
        const proposedIntent = this._schemaObj[frame.service]['intents'][intentName];
        let newItems = [];
        if (proposedIntent.is_transactional) {
            // This is an action
            const invocation = new Ast.Invocation(null, selector, fullIntentName, [], null);
            for (let key in selectedSlots[frame.service]) {
                if ((!proposedIntent.required_slots.includes(key) &&
                     !Object.keys(proposedIntent.optional_slots).includes(key)) ||
                     selectedSlots[frame.service][key][0] === 'dontcare') // TODO revisit this later. Is it right to just skip it? actions can't take dontcares, right?
                    continue;
                let ttValue = predictType(this._schemaObj[frame.service]['slots'][key], selectedSlots[frame.service][key][0]);
                invocation.in_params.push(new Ast.InputParam(null, key, ttValue));
            }
            const statement = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, invocation, null)]);
            newItems.push(new Ast.DialogueHistoryItem(null, statement, null, 'proposed'));
        } else { // This is a query
            const invocationTable = new Ast.Table.Invocation(null,
                new Ast.Invocation(null, selector, fullIntentName, [], null),
                null);
            const filterClauses = [];
            for (let key in selectedSlots[frame.service]) {
                if (!proposedIntent.required_slots.includes(key) &&
                    !Object.keys(proposedIntent.optional_slots).includes(key))
                    continue;
                let value = selectedSlots[frame.service][key][0];
                if (value == 'dontcare') {
                    filterClauses.push(new Ast.BooleanExpression.DontCare(null, key));
                    continue;
                }
                let ttValue = predictType(this._schemaObj[frame.service]['slots'][key], value);
                let op = '==';
                if (ttValue.isString)
                    op = '=~';
                filterClauses.push(new Ast.BooleanExpression.Atom(null, key, op, ttValue));
            }
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

    async _doAgentTurn(context, turn, agentUtterance, selectedSlots) {
        const frame = turn.frames[0]; // always only just frame with system
        let agentTarget;
        let actNames = frame.actions.map((action) => action.act);
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
            agentTarget = this._generateProposed(context, frame, selectedSlots);
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

    async _generateExecute(context, frame, selectedSlots, confirmed = false) {
        const tpClass = 'com.google.sgd';
        const selector = new Ast.Selector.Device(null, tpClass, null, null);
        const fullIntentName = frame.service + '_' + frame.state.active_intent;
        const newItems = [];
        const activeIntent = this._schemaObj[frame.service]['intents'][frame.state.active_intent];
        if (!Object.keys(selectedSlots).includes(frame.service))
            selectedSlots[frame.service] = {};
        selectedSlots[frame.service].activeIntent = activeIntent;
        if (activeIntent.is_transactional) { // This is an action
            const invocation = new Ast.Invocation(null, selector, fullIntentName, [], null);
            let confirmedState = (confirmed &&
                                  activeIntent.required_slots.every(val => val in frame.state.slot_values)) ?
                                 'confirmed' :
                                 'accepted';
            for (let key in frame.state.slot_values) {
                if (!activeIntent.required_slots.includes(key) &&
                    !Object.keys(activeIntent.optional_slots).includes(key))
                    continue;
                let ttValue = predictType(this._schemaObj[frame.service]['slots'][key], frame.state.slot_values[key][0]);
                invocation.in_params.push(new Ast.InputParam(null, key, ttValue));
            }
            const actionStmt = new Ast.Statement.Command(null, null, [new Ast.Action.Invocation(null, invocation, null)]);
            newItems.push(new Ast.DialogueHistoryItem(null, actionStmt, null, confirmedState));
        } else {
            // This is a query
            const invocationTable = new Ast.Table.Invocation(null,
                new Ast.Invocation(null, selector, fullIntentName, [], null),
                null);
            const filterClauses = [];
            for (let key in frame.state.slot_values) {
                if (!activeIntent.required_slots.includes(key) &&
                    !Object.keys(activeIntent.optional_slots).includes(key))
                    continue;
                let value = frame.state.slot_values[key][0];
                if (value == 'dontcare') {
                    filterClauses.push(new Ast.BooleanExpression.DontCare(null, key));
                    continue;
                }
                let ttValue = predictType(this._schemaObj[frame.service]['slots'][key], value);
                let op = '==';
                if (ttValue.isString)
                    op = '=~';
                filterClauses.push(new Ast.BooleanExpression.Atom(null, key, op, ttValue));
            }
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

    async _updateSelectedSlots(frame, selectedSlots) {
        for (let action of frame.actions) {
            if (action.act === 'SELECT') {
                if (action.slot === '') {
                    for (let slot in frame.state.slot_values)
                        selectedSlots[frame.service][slot] = frame.state.slot_values[slot];
                } else
                    selectedSlots[frame.service + '_' + action.slot] = action.values;
            }
        }
    }

    async _doUserTurn(context, turn, userUtterance, selectedSlots) {
        let frame = turn.frames[0];
        if (turn.frames.length > 1) {
            for (let candidateFrame of turn.frames) {
                if (!['SELECT', 'NEGATE_INTENT', 'THANK_YOU'].includes(candidateFrame.actions[0].act))
                    frame = candidateFrame;
            }
        }
        let userTarget;
        let actNames = frame.actions.map((action) => action.act);
        if (actNames.includes('SELECT'))
            userTarget = this._updateSelectedSlots(frame, selectedSlots); // we update selectedSlots, but we still don't have an annotation
        if (actNames.includes('INFORM') ||
            actNames.includes('INFORM_INTENT') ||
            actNames.includes('AFFIRM_INTENT') ||
            actNames.includes('REQUEST_ALTS')) { // execute
            userTarget = await this._generateExecute(context, frame, selectedSlots);
        } else if (actNames.includes('AFFIRM')) {
            userTarget = await this._generateExecute(context, frame, selectedSlots, true);
        } else if (actNames.includes('REQUEST')) {
            if (selectedSlots[frame.service].activeIntent.is_transactional) {
                // Action question. First, get the params, then build the state
                let requestActs = frame.actions.filter((action) => action.act === 'REQUEST');
                let slots =  requestActs.map((act) => act.slot);
                userTarget = new Ast.DialogueState(null, POLICY_NAME, 'action_question', slots, []);
            } else // it's a query with a projection
                userTarget = await this._generateExecute(context, frame, selectedSlots);
        } else if (actNames.includes('GOODBYE')) {
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'cancel', null, []);
        } else if (actNames.includes('THANK_YOU') ||
                   actNames.includes('REQ_MORE')) {
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'end', null, []);
        } else if (actNames.includes('NEGATE') ||
                   actNames.includes('SELECT')) {
            userTarget = new Ast.DialogueState(null, POLICY_NAME, 'cancel', null, []);
        } else {
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

        let context = null, simulatorState = undefined, selectedSlots = {};
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
                    const agentTarget = await this._doAgentTurn(context, aHalfTurn, agentUtterance, selectedSlots);
                    const oldContext = context;
                    context = this._target.computeNewState(context, agentTarget, 'agent');
                    const prediction = this._target.computePrediction(oldContext, context, 'agent');
                    agentTargetCode = prediction.prettyprint();

                }

                const userUtterance = uHalfTurn.utterance.replace(/\n/g, ' ');
                const userTarget = await this._doUserTurn(context, uHalfTurn, userUtterance, selectedSlots);
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
