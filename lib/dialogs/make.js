// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Intent = require('../semantic').Intent;
const Helpers = require('../helpers');

const ruleDialog = require('./rule');
const { slotFillSingle } = require('./slot_filling');

const CATEGORIES = ['media', 'social-network', 'home', 'communication', 'health', 'service', 'data-management'];
const PRIM_TYPES = ['trigger', 'query', 'action'];

function getCategoryList(dlg, primType) {
    const titles = [dlg._('Media'), dlg._('Social Networks'), dlg._('Home'), dlg._('Communication'),
                    dlg._('Health and Fitness'), dlg._('Services'), dlg._('Data Management')];

    dlg.reply(dlg._("Pick one from the following categories or simply type in."));
    let special =  JSON.stringify({ special: 'tt:root.special.empty' });
    if (primType === 'trigger')
        dlg.replyButton(dlg._("Do it now"), special);
    if (primType === 'action')
        dlg.replyButton(dlg._("Just notify me"), special);

    CATEGORIES.forEach((category, i) => {
        dlg.replyButton(titles[i], JSON.stringify({command: {type: 'help', value: {id: 'tt:type.' + category}}}));
    });
    dlg.replyButton(dlg._("Back"), JSON.stringify({ special: 'tt:root.special.back' }));
}

function getDeviceList(dlg, category) {
    return dlg.manager.thingpedia.getDeviceFactories(category).then((devices) => {
        let device_list = [];
        devices.forEach((device) => {
            if (!device.global_name)
                return;
            device_list.push([device.name, device.global_name]);
        });

        if (category === 'communication') {
            if (dlg.manager.devices.hasDevice('org.thingpedia.builtin.thingengine.phone'))
                device_list.push([dlg._("Phone"), 'phone']);
        }
        if (category === 'service')
            device_list.push([dlg._("Miscellaneous"), 'builtin']);

        dlg.reply(dlg._("Pick a command from the following devices"));
        device_list.forEach(([title, kind]) => {
            dlg.replyButton(title, JSON.stringify({ command: { type: 'help', value: { id: 'tt:device.' + kind }}}));
        });
        dlg.replyButton(dlg._("Back"), JSON.stringify({ special: 'tt:root.special.back' }));
    });
}

function getDeviceHelp(dlg, name, page, primType) {
    return dlg.manager.thingpedia.getExamplesByKinds([name], true).then((examples) => {
        let withSlot = true;
        examples = Helpers.filterExamplesByTypes(examples, [primType], withSlot);
        if (examples.length === 0) {
            dlg.reply(dlg._("Can't find a compatible command from %s, choose another device").format(name));
            dlg.replyButton(dlg._("Back"), JSON.stringify({ special: 'tt:root.special.back' }));
            return;
        }

        dlg.reply(dlg._("Pick a command below."));

        return Helpers.augmentExamplesWithSlotTypes(dlg.manager.schemas, examples).then(() => {
            let hasMore = examples.length > (page + 1) * 5;
            examples = examples.slice(page * 5, (page + 1) * 5);
            Helpers.presentExampleList(dlg, examples);
            if (hasMore)
                dlg.replyButton(dlg._("More…"), JSON.stringify({ command: { type: "help", value: { id: "tt:device." + name }, page: page + 1 } }));
            if (page > 0)
                dlg.replyButton(dlg._("Back"), JSON.stringify({ command: { type: "help", value: { id: "tt:device." + name }, page: page - 1 } }));
            else
                dlg.replyButton(dlg._("Back"), JSON.stringify({ special: 'tt:root.special.back' }));
            return true;
        });
    });
}

function makeFilterCandidates(prim) {
    let schema = prim.schema;
    let filterCandidates = [];
    for (let argname in schema.out) {
        let type = schema.out[argname];
        let ops;
        if (type.isString) {
            ops = ['=', '!=', '=~'];
        } else if (type.isNumber || type.isMeasure) {
            ops = ['=', '<', '>', '>=', '<='];
        } else if (type.isArray) {
            ops = ['contains'];
        } else {
            ops = ['=', '!='];
        }
        for (let op of ops)
            filterCandidates.push(new Ast.Filter(argname, op, Ast.Value.Undefined(true)));
    }
    return filterCandidates;
}

function describeFilter(dlg, _T, schema, filter) {
    let value = ThingTalk.Describe.describeArg(dlg.manager.gettext, filter.value);
    let argname = filter.name;
    let index = schema.index[argname];
    let argcanonical = schema.argcanonicals[index] || argname;

    // translations come from ThingTalk, hence the _T
    // otherwise they will be picked up by xgettext for Almond
    switch (filter.operator) {
    case 'contains':
    case 'substr':
    case '=~':
        return _T("%s contains %s").format(argcanonical, value);
    case 'in_array':
    case '~=':
        return _T("%s contains %s").format(value, argcanonical);
    case '=':
        return _T("%s is equal to %s").format(argcanonical, value);
    case '!=':
        return _T("%s is not equal to %s").format(argcanonical, value);
    case '<':
        return _T("%s is less than %s").format(argcanonical, value);
    case '>':
        return _T("%s is greater than %s").format(argcanonical, value);
    case '<=':
        return _T("%s is less than or equal to %s").format(argcanonical, value);
    case '>=':
        return _T("%s is greater than or equal to %s").format(argcanonical, value);
    default:
        throw new TypeError('Invalid operator ' + filter.operator);
    }
}


function* fillOnePrimitive(dlg, primType) {
    let helpState = 'categoryList';
    let category, kind, page;

    while (true) {
        if (helpState === 'categoryList')
            getCategoryList(dlg, primType);
        else if (helpState === 'deviceList')
            yield getDeviceList(dlg, category);
        else
            yield getDeviceHelp(dlg, kind, page, primType);
        let intent = yield dlg.expect(ValueCategory.Command);

        if (intent.isBack) {
            if (helpState === 'categoryList') // start at the top
                return undefined;
            else if (helpState === 'deviceList')
                helpState = 'categoryList';
            else
                helpState = 'deviceList';
            continue;
        }

        if (intent.isHelp) {
            if (intent.name.startsWith("tt:type")) {
                helpState = 'deviceList';
                category = intent.name.substr('tt:type.'.length);
            } else {
                helpState = 'deviceHelp';
                kind = intent.name;
                page = intent.page;
            }
            continue;
        }

        if (intent.isEmpty) {
            return null;
        } else {
            assert(intent.isPrimitive);
            return intent.primitive;
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
    }
}

function makeProgram(trigger, query, action) {
    let rule = new Ast.Rule(trigger, query ? [query] : [], action ? [action] : [ThingTalk.Generate.notifyAction()], false);
    return new Ast.Program('AlmondGenerated', [], [], [rule]);
}

function computeDescriptions(dlg, trigger, query, action) {
    let scope = {};
    return [
        trigger !== null ? ThingTalk.Describe.describePrimitive(dlg.manager.gettext, trigger, 'trigger', scope) : dlg._("now"),
        query !== null ? ThingTalk.Describe.describePrimitive(dlg.manager.gettext, query, 'query', scope) : '',
        action !== null ? ThingTalk.Describe.describePrimitive(dlg.manager.gettext, trigger, 'trigger', scope) : dlg._("notify me")
    ];
}

module.exports = function* makeDialog(dlg) {
    let utterances = [];
    let filterDescription = ['','',''];
    let filterCandidates = [[], []];
    let filters = [[], [], []];
    let rule = { trigger: null, query: null, action: null };
    let program = makeProgram(null, null, null);

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
            hint = dlg._("Click on one of the following buttons to start adding command.");
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
            filterCandidates[index].forEach((filter) => {
                let argname = filter.name;
                let ptype = schema.out[argname];
                let vtype = ptype;
                if (filter.operator === 'contains')
                    vtype = ptype.elem;

                let op;
                if (filter.operator === '=')
                    op = 'is';
                else if (filter.operator === '=~')
                    op = 'contains';
                else if (filter.operator === 'contains')
                    op = 'has';
                else
                    op = filter.operator;

                let obj = {
                    filter: {
                        name: argname,
                        operator: op,
                        value: null,
                        type: vtype.isMeasure ? 'Measure' : String(vtype)
                    }
                };
                if (vtype.isMeasure)
                    obj.filter.unit = vtype.unit;
                dlg.replyButton(describeFilter(dlg, _T, schema, filter), JSON.stringify(obj));
            });
            dlg.replyButton(dlg._("Back"), JSON.stringify({ special: 'tt:root.special.back' }));

            let filterIntent = yield dlg.expect(ValueCategory.Filter);
            if (filterIntent.isBack)
                continue;
            let filter = filterIntent.filter;
            let argname = filter.name;
            let ptype = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];

            if (filter.value.isUndefined) {
                let question = dlg._("What's the value of this filter?");
                let vtype = ptype;
                if (filter.operator === 'contains')
                    vtype = ptype.elem;
                filter.value = yield* slotFillSingle(dlg, vtype, question);
            }

            filters[index].push(filter);
            filterDescription[index] += ", " + describeFilter(dlg, _T, schema, filter);
        } else {
            let primType = PRIM_TYPES[index];
            let prim = yield* fillOnePrimitive(dlg, primType);
            if (prim === undefined)
                continue;

            rule[primType] = prim;
            program = makeProgram(rule.trigger, rule.query, rule.action);
            yield ThingTalk.Generate.typeCheckProgram(program, dlg.manager.schemas, true);

            utterances = computeDescriptions(dlg, rule.trigger, rule.query, rule.action);

            filterCandidates[index] = [];
            if (prim !== null)
                filterCandidates[index] = makeFilterCandidates(prim);

            filterDescription[index] = '';
            if (prim.selector.principal !== null)
                filterDescription[index] += dlg._(", owner is %s").format(ThingTalk.Describe.describeArg(dlg.manager.gettext, prim.selector.principal));
        }
    }

    // move filters into to the program
    for (let idx = 0; idx < 3; idx++) {
        let prim = rule[PRIM_TYPES[idx]];
        if (prim !== null) {
            prim.filter = Ast.BooleanExpression.And([prim.filter,
                Ast.BooleanExpression.And(filters[idx].map((f) => Ast.BooleanExpression.Atom(f)))]);
        }
    }

    return yield* ruleDialog(dlg, new Intent.Program(null, ThingTalk.Generate.optimizeProgram(program)), true);
}
