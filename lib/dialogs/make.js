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

function cleanCanonical(primType, canonical) {
    if (primType === 'trigger' && canonical.startsWith("when ")) canonical = canonical.substr("when ".length);
    if (primType === 'trigger' && canonical.startsWith("if ")) canonical = canonical.substr("if ".length);
    if (primType === 'trigger' && canonical.startsWith("whenever ")) canonical = canonical.substr("whenever ".length);
    if (primType === 'query' && canonical.startsWith("get ")) canonical = canonical.substr("get ".length);
    if (primType === 'query' && canonical.startsWith("show ")) canonical = canonical.substr("show ".length);
    return canonical;
}

function makeFilterCandidates(schema) {
    let filterCandidates = [];
    schema.schema.forEach((type, j) => {
        if (type.isString) {
            filterCandidates[i].push({
                type: "String",
                operator: "is",
                name: schema.args[j],
                value: null
            });
            filterCandidates[i].push({
                type: "String",
                operator: "contains",
                name: schema.args[j],
                value: null
            });
        } else if (type.isNumber) {
            filterCandidates[i].push({
                type: "Number",
                operator: "is",
                name: schema.args[j],
                value: null
            });
            filterCandidates[i].push({
                type: "Number",
                operator: "<",
                name: schema.args[j],
                value: null
            });
            filterCandidates[i].push({
                type: "Number",
                operator: ">",
                name: schema.args[j],
                value: null
            });
        } else if (type.isMeasure) {
            filterCandidates[i].push({
                type: "Measure",
                operator: "is",
                name: schema.args[j],
                value: null,
                unit: type.unit
            });
            filterCandidates[i].push({
                type: "Measure",
                operator: "<",
                name: schema.args[j],
                value: null,
                unit: type.unit
            });
            filterCandidates[i].push({
                type: "Measure",
                operator: ">",
                name: schema.args[j],
                value: null,
                unit: type.unit
            });
        } else if (type.isBoolean) {
            filterCandidates[i].push({
                type: "Bool",
                operator: "is",
                name: schema.args[j],
                value: null
            });
        } else if (type.isEntity && type.type === "tt:email_address") {
            filterCandidates[i].push({
                type: "Entity(tt:email_address)",
                operator: "is",
                name: schema.args[j],
                value: null
            })
        } else if (type.isEntity && type.type === "tt:phone_number") {
            filterCandidates[i].push({
                type: "Entity(tt:phone_number)",
                operator: "is",
                name: schema.args[j],
                value: null
            })
        }
    });
    return filterCandidates;
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
                return;
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
            let canonical = '';
            if (primType === 'trigger') canonical = ": now";
            else if (primType === 'action') canonical = ": notify me";
            return [canonical, undefined, []];
        } else {
            assert(intent.isPrimitive);

            let prim = intent.isPrimitive;
            // FIXME direct JSON access should not be needed
            let root = intent.root[primType];

            let schemaType;
            switch (primType) {
            case 'trigger':
                schemaType = 'triggers';
                break;
            case 'query':
                schemaType = 'queries';
                break;
            case 'action':
                schemaType = 'actions';
                break;
            }
            let schema = yield dlg.manager.schemas.getMeta(prim.selector.kind, schemaType, prim.channel);
            return [': ' + cleanCanonical(schema.canonical), root, makeFilterCandidates(schema)];
        }
    }
}

function describeFilter(filter) {
    if (filter.type === "Measure")
        return ", " + [filter.name, filter.operator, filter.value.value, filter.value.unit].join(' ');
    else
        return ", " + [filter.name, filter.operator, filter.value.value].join(' ');
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

module.exports = function* makeDialog(dlg) {
    let ready = false;
    let utterances = [];
    let filterDescription = [];
    let filterCandidates = [[], []];
    let filters = [[], [], []];
    let rule = {};

    while (true) {
        let hint;
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
            if (filterCandidates[0].length + filterCandidates[1].length + filterCandidates[2].length === 0) {
                dlg.reply("There is nothing to filter.");
                continue;
            }

            let filterCommandChoices = [];
            if (filterCandidates[0].length > 0)
                filterCommandChoices.push(['trigger', dlg._("When: %s").format(utterances[0] + filterDescription[0])]);
            if (filterCandidates[1].length > 0)
                filterCommandChoices.push(['query', dlg._("Get: %s").format(utterances[1] + filterDescription[1])]);
            filterCommandChoices.pish(['back', dlg._("Back")]);

            let choice = yield dlg.askChoices(dlg._("Pick the command you want to add filters to:"), filterCommandChoices.map(([i,t]) => t));
            if (choice === filterCommandChoices.length - 1) {
                // go back to the top
                continue;
            }
            let index = primToIndex(filterCommandChoices[choice][0]);

            dlg.reply(dlg._("Pick the filter you want to add:"));
            filterCandidates[index].forEach((filter, i) => {
                dlg.replyButton([filter.name.replace('_', ' '), filter.operator, '____'].join(' '), JSON.stringify({filter: filter}));
            });
            dlg.replyButton(dlg._("Back"), JSON.stringify({ special: 'tt:root.special.back' }));

            let filterIntent = yield this.expect(ValueCategory.Command);
            if (filterIntent.isBack)
                continue;
            if (!filterIntent.isFilter) {
                dlg.unexpected();
                continue;
            }

            if (filter.value === null) {
                let question = dlg._("What's the value of this filter?");
                let value;
                switch (filter.type) {
                case 'String':
                    value = yield dlg.ask(ValueCategory.RawString, question);
                    filter.value = {
                        value: value.value
                    };
                    break;
                case 'Number':
                    value = yield dlg.ask(ValueCategory.Number, question);
                    filter.value = {
                        value: value.value
                    };
                    break;
                case 'Measure':
                    value = yield dlg.ask(ValueCategory.Measure(filter.unit), question);
                    filter.value = {
                        value: value.value,
                        unit: value.unit
                    };
                    break;
                case 'Bool':
                    value = yield dlg.ask(ValueCategory.YesNo, question);
                    filter.value = {
                        value: value.value
                    };
                    break;
                case 'Entity(tt:email_address)':
                    value = yield dlg.ask(ValueCategory.EmailAddress, question);
                    filter.value = {
                        value: value.value,
                        display: value.display
                    };
                case 'Entity(tt:phone_number)':
                    value = yield dlg.ask(ValueCategory.PhoneNumber, question);
                    filter.value = {
                        value: value.value,
                        display: value.display
                    };
                default:
                    throw new Error('Unexpected argument type');
                }
            }

            filters[index].push(filter);
            filterDescription[index] += describeFilter(filter);
        } else {
            let primType = PRIM_TYPES[index];
            let result = yield* fillOnePrimitive(dlg, primType);
            if (result === null)
                continue;
            let [canonical, root, filters] = result;
            utterances[index] = canonical;
            rule[primType] = root;
            filterCandidates[index] = filters;

            filterDescription[index] = '';
            if (root.person)
                filterDescription[index] += ", owner is " + json[channel].person;
            root.args.forEach((arg) => {
                let filter = {
                    name: arg.name.id.substr("tt:param.".length),
                    type: arg.type,
                    operator: arg.operator,
                    value: arg.value.value
                };
                if (arg.type === "Measure")
                    filter.unit = arg.value.unit;
                filters[index].push(filter);
            });
            filterDescription[index] += filters[index].map(describeFilter).join('');
            // drop all the args and add them back later along with other filters
            // so that no duplicate check is needed when adding other filters
            root.args = [];
        }
    }

    // move filters back to the json
    for (let idx = 0; idx < 3; idx++) {
        filters[idx].forEach((filter) => {
            let arg = {
                name: {id: "tt:param." + filter.name},
                type: filter.type,
                value: filter.value,
                operator: filter.operator
            };
            rule[PRIM_TYPES[index]].args.push(arg);
        });
    }

    let programIntent = yield Intent.parse(rule, dlg.manager.schemas, null, null, null);
    return yield* ruleDialog(dlg, programIntent);
}
