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

const CATEGORIES = ['location', 'media', 'social-network', 'home', 'communication', 'service', 'data-management'];
const PRIM_TYPES = ['trigger', 'query', 'action'];

function getCategoryList(dlg, primType) {
    const titles = [dlg._('Location'), dlg._('Media'), dlg._('Social Networks'), dlg._('Home'), dlg._('Communication'),
                    dlg._('Services'), dlg._('Data Management')];

    dlg.reply(dlg._("Pick one from the following categories or simply type in."));
    if (primType === 'trigger')
        dlg.replySpecial(dlg._("Do it now"), 'empty');
    if (primType === 'action')
        dlg.replySpecial(dlg._("Just notify me"), 'empty');

    CATEGORIES.forEach((category, i) => {
        dlg.replyButton(titles[i], { code: ['bookkeeping', 'category', category], entities: {} });
    });
    dlg.replySpecial(dlg._("Back"), 'back');
}

function replyOneDevice(dlg, title, kind, category) {
    return dlg.replyButton(title, { code: ['bookkeeping', 'commands', category, 'device:' + kind], entities: {} });
}

function getDeviceList(dlg, category, primType, isLocal=true) {
    // HACK: bring location to the top level
    // filter examples by keywords (location, etc)
    if (category === 'location') {
        let kind = 'org.thingpedia.builtin.thingengine.phone';
        return getDeviceHelp(dlg, category, kind, 0, primType, isLocal, ['location']) ;
    }
    return dlg.manager.thingpedia.getDeviceFactories(category).then((devices) => {
        let device_list = [];
        devices.forEach((device) => {
            device_list.push([device.name, device.primary_kind]);
        });

        if (category === 'communication') {
            if (dlg.manager.devices.hasDevice('org.thingpedia.builtin.thingengine.phone'))
                device_list.push([dlg._("Phone"), 'org.thingpedia.builtin.thingengine.phone']);
        }
        if (category === 'service')
            device_list.push([dlg._("Miscellaneous"), 'org.thingpedia.builtin.thingengine.builtin']);

        dlg.reply(dlg._("Pick a command from the following devices"));
        device_list.forEach(([title, kind]) => {
            replyOneDevice(dlg, title, kind, category);
        });
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

        const exType = primTypeToExType(primType);
        let examples = allExamples.filter((ex) => ex !== null && ex.type === exType);
        if (examples.length === 0 && primType === 'trigger') {
            examples = allExamples.filter((ex) => ex !== null && ex.type === 'table' && ex.monitorable);
            examples.forEach((ex) => {
                ex.utterance = dlg._("when %s change").format(ex.utterance);
            });
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

function describePredicate(dlg, _T, schema, expr) {
    return (function recursiveHelper(expr) {
        if (expr.isTrue || (expr.isAnd && expr.operands.length === 0))
            return _T("true");
        if (expr.isFalse || (expr.isOr && expr.operands.length === 0))
            return _T("false");
        if ((expr.isAnd || expr.isOr) && expr.operands.length === 1)
            return recursiveHelper(expr.operands[0]);

        if (expr.isAnd)
            return expr.operands.map(recursiveHelper).reduce((x, y) => _T("%s and %s").format(x, y));
        if (expr.isOr)
            return expr.operands.map(recursiveHelper).reduce((x, y) => _T("%s or %s").format(x, y));
        if (expr.isNot)
            return _T("not %s").format(recursiveHelper(expr.expr));

        return Helpers.describeFilter(dlg, _T, schema, expr);
    })(expr);
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

function* fillOnePrimitive(dlg, primType, isLocal=true) {
    let helpState = 'categoryList';
    let category, kind, page = 0;

    while (true) {
        if (helpState === 'categoryList')
            getCategoryList(dlg, primType);
        else if (helpState === 'deviceList')
            yield getDeviceList(dlg, category, primType, isLocal);
        else
            yield getDeviceHelp(dlg, category, kind, page, primType, isLocal);
        let intent = yield dlg.expect(ValueCategory.Command);

        if (intent.isMore) {
            page++;
            continue;
        }

        if (intent.isBack) {
            if (helpState === 'categoryList') // start at the top
                return undefined;
            else if (helpState === 'deviceList')
                helpState = 'categoryList';
            else if (page > 0)
                page --;
            else
                helpState = 'deviceList';
            continue;
        }

        if (intent.isCommandList) {
            category = intent.category;
            if (intent.device === null) {
                helpState = 'deviceList';
            } else {
                helpState = 'deviceHelp';
                kind = intent.device;
                page = 0;
            }
            continue;
        }

        if (intent.isEmpty) {
            return undefined;
        } else {
            assert(intent.isProgram);
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
    let scope = {};
    return [
        trigger !== null ? ThingTalk.Describe.describeStream(dlg.manager.gettext, trigger, scope) : dlg._("now"),
        query !== null ? ThingTalk.Describe.describeTable(dlg.manager.gettext, query, scope) : '',
        action !== null ? ThingTalk.Describe.describePrimitive(dlg.manager.gettext, action, scope) : dlg._("notify me")
    ];
}

module.exports = function* makeDialog(dlg) {
    let utterances = [];
    let filterDescription = ['','',''];
    let filterCandidates = [[], []];
    let filters = [[], [], []];
    let rule = { trigger: null, query: null, action: null };
    let program = makeProgram(null, null, null);

    let hint = dlg._("Do you want to use your own account or others?");
    let choices = [dlg._("Use my own account"), dlg._("Use others' account")];
    let choice = yield dlg.askChoices(hint, choices);
    let isLocal = choice === 0;
    let user = null;

    if (!isLocal) {
        let answer = yield dlg.ask(ValueCategory.PhoneNumber, dlg._("Whose account do you want to use?"));
        let contact = {
            value: 'phone:' + answer.value,
            displayName: answer.display
        };
        user = yield makeContact(dlg, ValueCategory.Contact, contact);
    }

    while (true) {
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

        let index = yield dlg.askChoices(hint, choices);

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

            let choice = yield dlg.askChoices(dlg._("Pick the command you want to add filters to:"), filterCommandChoices.map(([i,t]) => t));
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

            let filterIntent = yield dlg.expect(ValueCategory.Predicate);
            if (filterIntent.isBack)
                continue;

            let predicate = filterIntent.predicate;
            for (let [,expr,] of ThingTalk.Generate.iterateSlotsFilter(null, predicate, null, null)) {
                if (expr.value.isUndefined) {
                    let argname = expr.name;
                    let ptype = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];

                    let question = dlg._("What's the value of this filter?");
                    let vtype = ptype;
                    if (expr.operator === 'contains')
                        vtype = ptype.elem;
                    expr.value = yield* slotFillCustom(dlg, vtype, question);
                }
            }

            filters[index].push(predicate);
            filterDescription[index] += ", " + describePredicate(dlg, _T, schema, predicate);
        } else {
            let primType = PRIM_TYPES[index];
            let prim = yield* fillOnePrimitive(dlg, primType, isLocal);
            if (prim === undefined)
                continue;
            if (prim === null) {
                dlg.fail();
                continue;
            }

            rule[primType] = prim;
            program = makeProgram(rule.trigger, rule.query, rule.action, user);
            yield ThingTalk.Generate.typeCheckProgram(program, dlg.manager.schemas, true);

            utterances = computeDescriptions(dlg, rule.trigger, rule.query, rule.action);
            if (!isLocal)
                utterances = utterances.map((u) => u.replace(/\b(your)\b/g, 'their').replace(/\b(you)\b/, 'them'));

            filterCandidates[index] = [];
            if (prim !== null)
                filterCandidates[index] = Helpers.makeFilterCandidates(prim);

            filterDescription[index] = '';

            // FIXME
            /*if (prim !== null && prim.selector.principal !== null)
                filterDescription[index] += dlg._(", owner is %s").format(ThingTalk.Describe.describeArg(dlg.manager.gettext, prim.selector.principal));*/
        }
    }

    // move filters into to the program
    if (rule.trigger !== null && filters[0] && filters[0].length > 0)
        rule.trigger = Ast.Stream.Filter(rule.trigger, Ast.BooleanExpression.And(filters[0]), rule.trigger.schema);
    if (rule.query !== null && filters[1] && filters[1].length > 0)
        rule.query = Ast.Table.Filter(rule.query, Ast.BooleanExpression.And(filters[1]), rule.query.schema);
    program = makeProgram(rule.trigger, rule.query, rule.action, user);

    if (program.principal)
        return yield* setupDialog(dlg, new Intent.Setup(ThingTalk.Generate.optimizeProgram(program)));
    else
        return yield* ruleDialog(dlg, new Intent.Program(ThingTalk.Generate.optimizeProgram(program)), true);
};
