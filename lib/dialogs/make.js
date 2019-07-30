// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//         Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const ValueCategory = require('../semantic').ValueCategory;
const Intent = require('../semantic').Intent;
const Helpers = require('../helpers');

const ruleDialog = require('./rule');
const setupDialog = require('./setup');
const { slotFillSingle, concretizeValue } = require('./slot_filling');
const { makeContact } = require('./contact_search');

const CATEGORIES = ['media', 'social-network', 'home', 'communication', 'service', 'data-management'];
const PRIM_TYPES = ['stream', 'query', 'action'];

function getCategoryList(dlg, primType) {
    const titles = [
        dlg._('Media (news, comics, meme, etc)'),
        dlg._('Social Networks (facebook, twitter, etc)'),
        dlg._('Home (camera, tv, etc)'),
        dlg._('Communication (phone, email, messenger, etc)'),
        dlg._('Services (weather, calendar, todo list, etc)'),
        dlg._('Data Management (cloud drives)')
    ];

    dlg.reply(dlg._("Pick one from the following categories or simply type in."));
    if (primType === 'stream')
        dlg.replySpecial(dlg._("Do it now"), 'empty');
    if (primType === 'action')
        dlg.replySpecial(dlg._("Just notify me"), 'empty');

    CATEGORIES.forEach((category, i) => {
        dlg.replyButton(titles[i], { code: ['bookkeeping', 'category', category], entities: {} });
    });
    if (primType !== 'all')
        dlg.replySpecial(dlg._("Back"), 'back');
}

function replyOneDevice(dlg, title, kind, category) {
    return dlg.replyButton(title, { code: ['bookkeeping', 'commands', category, 'device:' + kind], entities: {} });
}

const PAGE_SIZE = 10;
function getDeviceList(dlg, category, page) {
    return dlg.manager.thingpedia.getDeviceList(category, page, PAGE_SIZE).then((devices) => {
        dlg.reply(dlg._("Pick a command from the following devices"));

        let hasMore = devices.length > PAGE_SIZE;
        devices = devices.slice(0, PAGE_SIZE);
        devices.forEach((d) => {
            if (Helpers.isPlatformBuiltin(d.primary_kind) && dlg.manager.devices.getAllDevicesOfKind(d.primary_kind).length === 0)
                return;

            replyOneDevice(dlg, d.name, d.primary_kind, category);
        });
        if (hasMore)
            dlg.replySpecial(dlg._("More…"), 'more');
        dlg.replySpecial(dlg._("Back"), 'back');
    });
}

async function getDeviceHelp(dlg, category, name, page, primType, isLocal=true, keywords=[]) {
    const dataset = await dlg.manager.thingpedia.getExamplesByKinds([name], true);
    const allExamples = await Helpers.loadExamples(dlg, dataset);

    let examples;

    if (primType === 'all') {
        let streams = allExamples.filter((ex) => ex.type === 'stream');
        if (streams.length === 0) {
            streams = allExamples.filter((ex) => ex.type === 'query' && ex.monitorable);
            streams = streams.map((ex) => {
                let stream = JSON.parse(JSON.stringify(ex));
                stream.utterance = dlg._("when %s change notify me").format(ex.utterance);
                stream.type = 'stream';
                return stream;
            });

            examples = allExamples.concat(streams);
        } else {
            examples = allExamples;
        }
        examples.forEach((ex) => {
            if (ex.type === 'query')
                ex.utterance = dlg._("get %s").format(ex.utterance);
            if (ex.type === 'stream')
                ex.utterance = dlg._("%s notify me").format(ex.utterance);
            return ex;
        });
    } else {
        examples = allExamples.filter((ex) => ex.type === primType);
        if (examples.length === 0 && primType === 'stream') {
            examples = allExamples.filter((ex) => ex.type === 'query' && ex.monitorable);
            examples.forEach((ex) => {
                ex.utterance = dlg._("when %s change").format(ex.utterance);
            });
        }
    }
    if (examples.length === 0) {
        dlg.reply(dlg._("Can't find a compatible command from %s, choose another device").format(Helpers.cleanKind(name)));
        dlg.replySpecial(dlg._("Back"), 'back');
        return;
    }
    if (keywords.length !== 0) {
        examples = examples.filter((ex) => {
            let containKeywords = false;
            for (let k of keywords) {
                if (ex.utterance.includes(k))
                    containKeywords = true;
            }
            return containKeywords;
        });
    }

    dlg.reply(dlg._("Pick a command below."));

    let hasMore = examples.length > (page + 1) * 5;
    examples = examples.slice(page * 5, (page + 1) * 5);
    Helpers.presentExampleList(dlg, examples, isLocal);
    if (hasMore)
        dlg.replySpecial(dlg._("More…"), 'more');
    dlg.replySpecial(dlg._("Back"), 'back');
}

function primitiveFromProgram(program, primType) {
    let rule = program.rules[0];
    if (!rule)
        return null;

    if (primType === 'stream' && rule.stream)
        return rule.stream;
    if (primType === 'stream' && rule.table)
        return new Ast.Stream.Monitor(rule.table, null, rule.table.schema);
    if (primType === 'query' && rule.table)
        return rule.table;
    if (primType === 'action' && rule.actions.length && !rule.actions[0].invocation.selector.isBuiltin)
        return rule.actions[0].invocation;
    return null;
}

async function fillOnePrimitive(dlg, primType, isLocal=true) {
    let helpState = 'categoryList';
    let category, kind, page = 0;

    for (;;) {
        if (helpState === 'categoryList')
            getCategoryList(dlg, primType);
        else if (helpState === 'deviceList')
            await getDeviceList(dlg, category, page);
        else
            await getDeviceHelp(dlg, category, kind, page, primType, isLocal);
        let intent = await dlg.expect(ValueCategory.Command);

        if (intent.isMore) {
            page++;
            continue;
        }

        if (intent.isBack) {
            if (helpState === 'categoryList') // start at the top
                return primType === 'all' ? [undefined, undefined] : undefined;
            else if (page > 0)
                page --;
            else if (helpState === 'deviceList')
                helpState = 'categoryList';
            else
                helpState = 'deviceList';
            continue;
        }

        if (intent.isCommandList) {
            category = intent.category;
            if (intent.device === null) {
                helpState = 'deviceList';
                page = 0;
            } else {
                helpState = 'deviceHelp';
                kind = intent.device;
                page = 0;
            }
            continue;
        }

        if (intent.isEmpty) {
            return primType === 'all' ? [undefined, undefined] : undefined;
        } else {
            assert(intent.isProgram);
            if (primType === 'all') {
                let rule = intent.program.rules[0];
                if (rule.stream)
                    primType = 'stream';
                else if (rule.table)
                    primType = 'query';
                else
                    primType = 'action';
                return [primType, primitiveFromProgram(intent.program, primType)];
            }
            return primitiveFromProgram(intent.program, primType);
        }
    }
}

function primToIndex(primType) {
    switch (primType) {
        case 'stream':
            return 0;
        case 'query':
            return 1;
        case 'action':
            return 2;
        default:
            throw new TypeError();
    }
}

function makeProgram(stream, query, action, executor=null) {
    let rule;
    if (action)
        action = new ThingTalk.Ast.Action.Invocation(action, null);
    else
        action = ThingTalk.Generate.notifyAction(executor ? 'return' : 'notify');
    if (stream && query)
        rule = new Ast.Statement.Rule(new Ast.Stream.Join(stream, query, [], null), [action]);
    else if (stream)
        rule = new Ast.Statement.Rule(stream, [action]);
    else
        rule = new Ast.Statement.Command(query, [action]);
    return new Ast.Program([], [], [rule], executor);
}

function computeDescriptions(dlg, stream, query, action) {
    return [
        stream !== null ? ThingTalk.Describe.describeStream(dlg.manager.gettext, stream) : dlg._("now"),
        query !== null ? ThingTalk.Describe.describeTable(dlg.manager.gettext, query) : '',
        action !== null ? ThingTalk.Describe.describePrimitive(dlg.manager.gettext, action) : dlg._("notify me")
    ];
}

const ENABLE_REMOTE_COMMANDS = false;
const ENABLE_WHEN_GET_DO = false;

module.exports = async function makeDialog(dlg, startIntent) {
    let utterances = [];
    let filterDescription = ['','',''];
    let filterCandidates = [[], []];
    let filters = [[], [], []];
    let rule = { stream: null, query: null, action: null };

    let isLocal = true;
    let user = null;
    /* istanbul ignore if */
    if (ENABLE_REMOTE_COMMANDS) {
        let hint = dlg._("Do you want to use your own account or others?");
        let choices = [dlg._("Use my own account"), dlg._("Use others' account")];
        let choice = await dlg.askChoices(hint, choices);
        let isLocal = choice === 0;

        if (!isLocal) {
            let answer = await dlg.ask(ValueCategory.PhoneNumber, dlg._("Whose account do you want to use?"));
            let contact = {
                value: 'phone:' + answer.value,
                displayName: answer.display
            };
            user = await makeContact(dlg, ValueCategory.Contact, contact);
            let slot = {
                value: user,
                get() { return this.value; },
                set(v) { this.value = v; },
                type: Type.Entity('tt:contact')
            };
            let ok = concretizeValue(dlg, slot);
            if (!ok)
                return;
            user = slot.get();
        }
    }

    /* istanbul ignore if */
    if (ENABLE_WHEN_GET_DO) {
        for (;;) {
            let hint;
            let ready = utterances[0] || utterances[1] || utterances[2];
            let choices = [utterances[0] ? dlg._("When: %s").format(utterances[0] + filterDescription[0]) : dlg._("When"),
                utterances[1] ? dlg._("Get: %s").format(utterances[1] + filterDescription[1]) : dlg._("Get"),
                utterances[2] ? dlg._("Do: %s").format(utterances[2] + filterDescription[2]) : dlg._("Do")];
            if (ready) {
                hint = dlg._("Add more commands and filters or run your command if you are ready.");
                if (utterances[0] || utterances[1])
                    choices.push(dlg._("Add a filter"));
                choices.push(dlg._("Run it"));
            } else {
                hint = dlg._("Click on one of the following buttons to start adding commands.");
            }

            let index = await dlg.askChoices(hint, choices);

            if (index === 4) // run it
                break;
            if (index === 3) {
                if (filterCandidates[0].length + filterCandidates[1].length === 0) {
                    dlg.reply("There is nothing to filter.");
                    continue;
                }

                let filterCommandChoices = [];
                if (filterCandidates[0].length > 0)
                    filterCommandChoices.push(['stream', dlg._("When: %s").format(utterances[0] + filterDescription[0])]);
                if (filterCandidates[1].length > 0)
                    filterCommandChoices.push(['query', dlg._("Get: %s").format(utterances[1] + filterDescription[1])]);
                filterCommandChoices.push(['back', dlg._("Back")]);

                let choice = await dlg.askChoices(dlg._("Pick the command you want to add filters to:"), filterCommandChoices.map(([i,t]) => t));
                if (choice === filterCommandChoices.length - 1) {
                    // go back to the top
                    continue;
                }
                let primType = filterCommandChoices[choice][0];
                let prim = rule[primType];
                let index = primToIndex(primType);

                dlg.reply(dlg._("Pick the filter you want to add:"));

                // reuse thingtalk's translations here
                const _T = dlg.manager.gettext.dgettext.bind(dlg.manager.gettext, 'thingtalk');
                const schema = prim.schema;
                Helpers.presentFilterCandidates(dlg, _T, schema, filterCandidates[index]);
                dlg.replySpecial(dlg._("Back"), 'back');

                let filterIntent = await dlg.expect(ValueCategory.Predicate);
                if (filterIntent.isBack)
                    continue;

                let predicate = filterIntent.predicate;
                await predicate.typecheck(schema, null, dlg.manager.schemas, {}, true);
                for (let slot of predicate.iterateSlots2(schema, prim, {}))
                    await slotFillSingle(dlg, slot, null);

                filters[index].push(predicate);
                filterDescription[index] += ", " + Helpers.describeFilter(dlg, schema, predicate);
            } else {
                let primType = PRIM_TYPES[index];
                let prim = await fillOnePrimitive(dlg, primType, isLocal);
                if (prim === undefined)
                    continue;
                if (prim === null) {
                    dlg.fail();
                    continue;
                }

                rule[primType] = prim;
                const program = makeProgram(rule.stream, rule.query, rule.action, user);
                await program.typecheck(dlg.manager.schemas, true);

                utterances = computeDescriptions(dlg, rule.stream, rule.query, rule.action);
                if (!isLocal)
                    utterances = utterances.map((u) => u.replace(/\b(your)\b/g, 'their').replace(/\b(you)\b/, 'them'));

                filterCandidates[index] = Helpers.makeFilterCandidates(prim);

                filterDescription[index] = '';
            }
        }
    } else {
        let index;
        let primType;
        for (;;) {
            let hint;
            let choices = [];
            let ready = !!utterances[index];
            if (ready) {
                let format;
                if (primType === 'stream' && !utterances[index].endsWith('notify me'))
                    format = "%s notify me";
                else if (primType === 'query' && !utterances[index].startsWith('get'))
                    format = "get %s";
                else
                    format = "%s";
                const description = format.format(utterances[index] + filterDescription[index]);
                choices.push(dlg._("Choose a different command"));
                if (primType !== 'action')
                    choices.push(dlg._("Add a filter"));
                choices.push(dlg._("Run it"));
                hint = dlg._("Your command is: %s. You can add more filters or run your command if you are ready.")
                    .format(description);
                index = await dlg.askChoices(hint, choices);
            } else {
                index = 0;
            }

            if (index === choices.length-1) // run it
                break;
            if (index === 1) {
                index = primToIndex(primType);
                if (filterCandidates[0].length + filterCandidates[1].length === 0) {
                    dlg.reply("There is nothing to filter.");
                    continue;
                }

                let filterCommandChoices = [];
                if (filterCandidates[0].length > 0)
                    filterCommandChoices.push(['stream', dlg._("When: %s").format(utterances[0] + filterDescription[0])]);
                if (filterCandidates[1].length > 0)
                    filterCommandChoices.push(['query', dlg._("Get: %s").format(utterances[1] + filterDescription[1])]);

                dlg.reply(dlg._("Choose the filter you want to add:"));

                const schema = rule[primType].schema;
                Helpers.presentFilterCandidates(dlg, schema, filterCandidates[index]);
                dlg.replySpecial(dlg._("Back"), 'back');

                let filterIntent = await dlg.expect(ValueCategory.Predicate);
                if (filterIntent.isBack)
                    continue;

                let predicate = filterIntent.predicate;
                await predicate.typecheck(schema, null, dlg.manager.schemas, {}, true);
                for (let slot of predicate.iterateSlots2(schema, rule[primType], {}))
                    await slotFillSingle(dlg, slot, null);

                index = primToIndex(primType);
                filters[index].push(predicate);
                filterDescription[index] += ", " + Helpers.describeFilter(dlg, schema, predicate);
            } else {
                let prim;
                [primType, prim] = await fillOnePrimitive(dlg, 'all', isLocal);
                if (prim === undefined)
                    continue;
                if (prim === null) {
                    dlg.fail();
                    continue;
                }
                rule.stream = null;
                rule.query = null;
                rule.action = null;
                rule[primType] = prim;
                const program = makeProgram(rule.stream, rule.query, rule.action, user);
                await program.typecheck(dlg.manager.schemas, true);

                utterances = computeDescriptions(dlg, rule.stream, rule.query, rule.action);
                if (!isLocal)
                    utterances = utterances.map((u) => u.replace(/\b(your)\b/g, 'their').replace(/\b(you)\b/, 'them'));

                index = primToIndex(primType);
                filterCandidates = [[], []];
                filterCandidates[index] = Helpers.makeFilterCandidates(prim);
            }
        }
    }

    // move filters into to the program
    if (rule.stream !== null && filters[0] && filters[0].length > 0)
        rule.stream = Ast.Stream.Filter(rule.stream, Ast.BooleanExpression.And(filters[0]), rule.stream.schema);
    if (rule.query !== null && filters[1] && filters[1].length > 0)
        rule.query = Ast.Table.Filter(rule.query, Ast.BooleanExpression.And(filters[1]), rule.query.schema);
    let program = makeProgram(rule.stream, rule.query, rule.action, user);

    program = program.optimize();
    if (program === null)
        return;

    if (program.principal)
        await setupDialog(dlg, new Intent.Setup(program, program, startIntent.plaformData));
    else
        await ruleDialog(dlg, new Intent.Program(program, program, startIntent.plaformData), true);
};
