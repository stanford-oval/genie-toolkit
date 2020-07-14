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
const Type = ThingTalk.Type;

const ParserClient = require('../../../lib/prediction/parserclient');
const { DialogueSerializer } = require('../../lib/dialog_parser');
const StreamUtils = require('../../../lib/utils/stream-utils');
const MultiJSONDatabase = require('../../lib/multi_json_database');
const ProgressBar = require('../../lib/progress_bar');
const { getBestEntityMatch } = require('../../../lib/dialogue-agent/entity-linking/entity-finder');
const TargetLanguages = require('../../../lib/languages');

class Converter extends stream.Readable {
    constructor(args) {
        super({ objectMode: true });
        this._tpClient = new Tp.FileClient(args);
    } /* TODO remove comment and adapt
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
    } TODO remove comment and adapt */

    _read() {}

    /* TODO remove comment and adapt
    async start() {
        await this._database.load();
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
        let agentTarget = await this._parseUtterance(context, this._agentParser, agentUtterance, 'agent');

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
        const resolved = getBestEntityMatch(value.display, value.type, this._getIDs(value.type));
        value.value = resolved.value;

        // do not override the display field, it should match the sentence instead
        // it will be overridden later when round-tripped through the executor
        //value.display = resolved.display;
    }

    async _doUserTurn(context, contextInfo, turn, userUtterance, slotBag) {
        const allSlots = new Map;

        for (let slot of turn.belief_state) {
            assert(slot.act === 'inform');

            let [key, value] = slot.slots[0];
            assert(typeof key === 'string');
            assert(typeof value === 'string');

            if (value === 'none')
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
            let userTarget = await this._parseUtterance(context, this._userParser, userUtterance, 'user');

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
    }

TODO remove comment and adapt   */ 

    async _doDialogue(dlg) {
        const id = dlg.dialogue_id;

        let context = null, contextInfo = { current: null, next: null },
            simulatorState = undefined, slotBag = new Map;
        const turns = [];
        for (let idx = 0; idx < dlg.turns.length; idx = idx+2) {
            const uHalfTurn = dlg.turns[idx];
            const aHalfTurn = dlg.turns[idx+1];

            try {
                let contextCode = '', agentUtterance = '', agentTargetCode = '';
                agentUtterance = aHalfTurn.utterance;

                /* TODO remove comment and adapt
                if (context !== null) {

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

                const userTarget = await this._doUserTurn(context, contextInfo, turn, userUtterance, slotBag);
                const oldContext = context;
                context = this._target.computeNewState(context, userTarget, 'user');
                const prediction = this._target.computePrediction(oldContext, context, 'user');
                const userTargetCode = prediction.prettyprint();
                TODO remove comment and adapt */

                const userUtterance = uHalfTurn.utterance;
                const userTargetCode = '';
                
                turns.push({
                    context: contextCode,
                    agent: agentUtterance,
                    agent_target: agentTargetCode,
                    user: userUtterance,
                    user_target: userTargetCode,
                });

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
        parser.addArgument(['--input_file'], {
            required: true,
            help: 'Input dialog file'
        });
    },

    async execute(args) {
        const data = JSON.parse(await util.promisify(fs.readFile)(args.input_file, { encoding: 'utf8' }));

        const converter = new Converter(args);
        const learned = new DialogueSerializer({ annotations: false }); // TODO Change to true once ready
        const promise = StreamUtils.waitFinish(converter.pipe(learned).pipe(args.output));

        const progbar = new ProgressBar(1);
        converter.on('progress', (value) => {
            progbar.update(value);
        });

        // issue an update now to show the progress bar
        progbar.update(0);

        //await converter.start();
        await converter.run(data);

        console.log('Finished, waiting for pending writes...');
        await promise;
        console.log('Everything done...');

        // we need this otherwise we hang at exit, due to some open file I cannot find...
        setTimeout(() => process.exit(), 10000);
    }
};
