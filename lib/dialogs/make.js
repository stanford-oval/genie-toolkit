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

const ValueCategory = require('../semantic').ValueCategory;
const Intent = require('../semantic').Intent;
const Helpers = require('../helpers');

const ruleDialog = require('./rule');
const setupDialog = require('./setup');
const { slotFillCustom } = require('./slot_filling');
const { makeContact } = require('./contact_search');

const CATEGORIES = ['media', 'social-network', 'home', 'communication', 'service', 'data-management'];
const PRIM_TYPES = ['trigger', 'query', 'action'];

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
    if (primType === 'trigger')
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
    return dlg.manager.thingpedia.getDeviceList(category, page, PAGE_SIZE).then(({ devices }) => {
        dlg.reply(dlg._("Pick a command from the following devices"));
        let hasMore = devices.length > PAGE_SIZE;
        devices = devices.slice(0, PAGE_SIZE);
        devices.forEach((d) => {
            replyOneDevice(dlg, d.name, d.primary_kind, category);
        });
        if (hasMore)
            dlg.replySpecial(dlg._("More…"), 'more');
        dlg.replySpecial(dlg._("Back"), 'back');
    });
}

function primTypeToExType(primType) {
    switch (primType) {
        case 'trigger':
            return 'stream';
        case 'query':
            return 'table';
        case 'action':
            return 'action';
        default:
            throw new TypeError();
    }
}

function getDeviceHelp(dlg, category, name, page, primType, isLocal=true, keywords=[]) {
    return dlg.manager.thingpedia.getExamplesByKinds([name], true)
        .then((examples) => Helpers.loadExamples(dlg, examples))
        .then((allExamples) => {
            allExamples = allExamples.filter((ex) => ex !== null);

            let examples;
            if (primType === 'all') {
                let triggers = allExamples.filter((ex) => ex.type === 'table' && ex.monitorable);
                triggers = triggers.map((ex) => {
                    let trigger = JSON.parse(JSON.stringify(ex));
                    trigger.utterance = dlg._("when %s change notify me").format(ex.utterance);
                    return trigger;
                });

                allExamples.map((ex) => {
                    if (ex.type === 'table')
                        ex.utterance = dlg._("get %s").format(ex.utterance);
                    if (ex.type === 'stream')
                        ex.utterance = dlg._("%s notify me").format(ex.utterance);
                    return ex;
                });
                examples = allExamples.concat(triggers);

            } else {
                const exType = primTypeToExType(primType);
                examples = allExamples.filter((ex) => ex.type === exType);
                if (examples.length === 0 && primType === 'trigger') {
                    examples = allExamples.filter((ex) => ex.type === 'table' && ex.monitorable);
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
            const programs = new Set;
            examples = examples.filter((ex) => {
                if (keywords.length !== 0) {
                    let containKeywords = false;
                    for (let k of keywords) {
                        if (ex.utterance.includes(k))
                            containKeywords = true;
                    }
                    if (!containKeywords)
                        return false;
                }
                const program = ex.target.code.join(' ');
                if (programs.has(program))
                    return false;
                programs.add(program);
                return true;
            });

            dlg.reply(dlg._("Pick a command below."));

            let hasMore = examples.length > (page + 1) * 5;
            examples = examples.slice(page * 5, (page + 1) * 5);
            Helpers.presentExampleList(dlg, examples, isLocal);
            if (hasMore)
                dlg.replySpecial(dlg._("More…"), 'more');
            dlg.replySpecial(dlg._("Back"), 'back');
        });
}

function primitiveFromProgram(program, primType) {
    let rule = program.rules[0];
    if (!rule)
        return null;

    if (primType === 'trigger' && rule.stream)
        return rule.stream;
    if (primType === 'trigger' && rule.table)
        return new Ast.Stream.Monitor(rule.table, null, rule.table.schema);
    if (primType === 'query' && rule.table)
        return rule.table;
    if (primType === 'action' && rule.actions.length && !rule.actions[0].selector.isBuiltin)
        return rule.actions[0];
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
                    primType = 'trigger';
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
        case 'trigger':
            return 0;
        case 'query':
            return 1;
        case 'action':
            return 2;
        default:
            throw new TypeError();
    }
}

function makeProgram(trigger, query, action, executor=null) {
    let rule;
    if (trigger && query)
        rule = new Ast.Statement.Rule(new Ast.Stream.Join(trigger, query, [], null), action ? [action] : [ThingTalk.Generate.notifyAction(executor ? 'return' : 'notify')]);
    else if (trigger)
        rule = new Ast.Statement.Rule(trigger, action ? [action] : [ThingTalk.Generate.notifyAction(executor ? 'return' : 'notify')]);
    else
        rule = new Ast.Statement.Command(query, action ? [action] : [ThingTalk.Generate.notifyAction(executor ? 'return' : 'notify')]);
    return new Ast.Program([], [], [rule], executor);
}

function computeDescriptions(dlg, trigger, query, action) {
    return [
        trigger !== null ? ThingTalk.Describe.describeStream(dlg.manager.gettext, trigger) : dlg._("now"),
        query !== null ? ThingTalk.Describe.describeTable(dlg.manager.gettext, query) : '',
        action !== null ? ThingTalk.Describe.describePrimitive(dlg.manager.gettext, action) : dlg._("notify me")
    ];
}

const ENABLE_REMOTE_COMMANDS = false;
const ENABLE_WHEN_GET_DO = false;

module.exports = async function makeDialog(dlg) {
    let utterances = [];
    let filterDescription = ['','',''];
    let filterCandidates = [[], []];
    let filters = [[], [], []];
    let rule = { trigger: null, query: null, action: null };
    let program = makeProgram(null, null, null);

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
                    filterCommandChoices.push(['trigger', dlg._("When: %s").format(utterances[0] + filterDescription[0])]);
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
                for (let [,expr,] of predicate.iterateSlots(null, null, null)) {
                    if (expr.value.isUndefined) {
                        let argname = expr.name;
                        let ptype = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];

                        let question = dlg._("What's the value of this filter?");
                        let vtype = ptype;
                        if (expr.operator === 'contains')
                            vtype = ptype.elem;
                        expr.value = await slotFillCustom(dlg, vtype, question);
                    }
                }

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
                program = makeProgram(rule.trigger, rule.query, rule.action, user);
                await program.typecheck(dlg.manager.schemas, true);

                utterances = computeDescriptions(dlg, rule.trigger, rule.query, rule.action);
                if (!isLocal)
                    utterances = utterances.map((u) => u.replace(/\b(your)\b/g, 'their').replace(/\b(you)\b/, 'them'));

                filterCandidates[index] = [];
                if (prim !== null)
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
                if (primType === 'trigger' && !utterances[index].endsWith('notify me'))
                    format = "%s notify me";
                else if (primType === 'query' && !utterances[index].startsWith('get'))
                    format = "get %s";
                else
                    format = "%s";
                const description = format.format(utterances[index] + filterDescription[index]);
                choices.push(dlg._("Choose a different command"));
                choices.push(dlg._("Add a filter"));
                choices.push(dlg._("Run it"));
                hint = dlg._("Your command is: %s. You can add more filters or run your command if you are ready.")
                    .format(description);
                index = await dlg.askChoices(hint, choices);
            } else {
                index = 0;
            }

            if (index === 2) // run it
                break;
            if (index === 1) {
                index = primToIndex(primType);
                if (filterCandidates[0].length + filterCandidates[1].length === 0) {
                    dlg.reply("There is nothing to filter.");
                    continue;
                }

                let filterCommandChoices = [];
                if (filterCandidates[0].length > 0)
                    filterCommandChoices.push(['trigger', dlg._("When: %s").format(utterances[0] + filterDescription[0])]);
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
                for (let [,expr,] of predicate.iterateSlots(null, null, null)) {
                    if (expr.value.isUndefined) {
                        let argname = expr.name;
                        let ptype = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];

                        let question = dlg._("What's the value of this filter?");
                        let vtype = ptype;
                        if (expr.operator === 'contains')
                            vtype = ptype.elem;
                        expr.value = await slotFillCustom(dlg, vtype, question);
                    }
                }

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
                rule.trigger = null;
                rule.query = null;
                rule.action = null;
                rule[primType] = prim;
                program = makeProgram(rule.trigger, rule.query, rule.action, user);
                await program.typecheck(dlg.manager.schemas, true);

                utterances = computeDescriptions(dlg, rule.trigger, rule.query, rule.action);
                if (!isLocal)
                    utterances = utterances.map((u) => u.replace(/\b(your)\b/g, 'their').replace(/\b(you)\b/, 'them'));

                index = primToIndex(primType);
                filterCandidates = [[], []];
                if (prim !== null)
                    filterCandidates[index] = Helpers.makeFilterCandidates(prim);
            }
        }
    }

    // move filters into to the program
    if (rule.trigger !== null && filters[0] && filters[0].length > 0)
        rule.trigger = Ast.Stream.Filter(rule.trigger, Ast.BooleanExpression.And(filters[0]), rule.trigger.schema);
    if (rule.query !== null && filters[1] && filters[1].length > 0)
        rule.query = Ast.Table.Filter(rule.query, Ast.BooleanExpression.And(filters[1]), rule.query.schema);
    program = makeProgram(rule.trigger, rule.query, rule.action, user);

    if (program.principal)
        return await setupDialog(dlg, new Intent.Setup(program.optimize()));
    else
        return await ruleDialog(dlg, new Intent.Program(program.optimize()), true);
};