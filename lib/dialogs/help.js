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
const Helpers = require('../helpers');

const CATEGORIES = ['media', 'social-network', 'home', 'communication', 'health', 'service', 'data-management'];

function getAppHelp(dlg, page) {
    return dlg.manager.thingpedia.getApps(page * 5, 6).then((apps) => {
        let hasMore = apps.length > 5;
        apps.forEach((app) => {
            dlg.replyButton(app.name, JSON.stringify({ action: { name: { id: 'tt:' + app.app_id + '.invoke' }, args: [] }}));
        });
        if (hasMore)
            dlg.replyButton(dlg._("More…"), JSON.stringify({ command: { type: "help", value: { id: "tt:type.apps" }, page: page + 1 } }));
        dlg.replyButton(dlg._("Back"), JSON.stringify({ command: { type: "help", value: { value: 'generic' }}}));
    });
}

function getDeviceHelp(dlg, category, name, page) {
    return dlg.manager.thingpedia.getExamplesByKinds([name], true).then((examples) => {
        if (examples.length === 0) {
            // should never get here for non-developers
            dlg.reply(dlg._("There is no example commands for %s.").format(name));
            dlg.reply(dlg._("Try adding examples at https://thingengine.stanford.edu/thingpedia/devices if you are testing as a developer."));
            return;
        }
        dlg.reply(dlg._("Here's what I can do for you on %s.").format(name.replace(/_/g, ' ')));

        examples = Helpers.filterExamples(examples);
        return Helpers.augmentExamplesWithSlotTypes(dlg.manager.schemas, examples).then(() => {
            let hasMore = examples.length > (page + 1) * 5;
            examples = examples.slice(page * 5, (page + 1) * 5);
            Helpers.presentExampleList(dlg, examples);
            if (hasMore)
                dlg.replyButton(dlg._("More…"), JSON.stringify({ command: { type: "help", value: { id: "tt:device." + name }, page: page + 1, category: category } }));
            if (page > 0)
                dlg.replyButton(dlg._("Back"), JSON.stringify({ command: { type: "help", value: { id: "tt:device." + name }, page: page - 1, category: category } }));
            else if (category)
                dlg.replyButton(dlg._("Back"), JSON.stringify({ command: { type: "help", value: { id: "tt:type." + category }}}));
            else
                dlg.replyButton(dlg._("Back"), JSON.stringify({ command: { type: "help", value: { value: 'generic' }}}));
        });
    });
}

function replyOneDevice(dlg, title, kind, category) {
    return dlg.replyButton(title, JSON.stringify({ command: { type: 'help', value: { display: title, value: kind }, category: category }}));
}

function replyOneCategory(dlg, title, category) {
    return dlg.replyButton(title, JSON.stringify({command: {type: 'help', value: {id: 'tt:type.' + category}}}));
}

function getCategoryList(dlg) {
    let titles = [dlg._('Media'), dlg._('Social Networks'), dlg._('Home'), dlg._('Communication'),
                  dlg._('Health and Fitness'), dlg._('Services'), dlg._('Data Management')];

    dlg.reply(dlg._("Here is a list of what I can do. Click on each of the categories to see corresponding devices."));
    for (let i = 0; i < 7; i++)
        replyOneCategory(dlg, titles[i], CATEGORIES[i]);
    dlg.replyButton(dlg._("Make Your Own Rule"), JSON.stringify({special: 'tt:root.special.makerule'}));
}

function getDeviceList(dlg, category, page) {
    if (category === 'apps')
        return getAppHelp(dlg, page);

    let device_list = [];
    let index = CATEGORIES.indexOf(category);
    if (index < 0) {
        dlg.reply(dlg._("No category %s.").format(category));
        return;
    }

    let titles = [dlg._('Media'), dlg._('Social Networks'), dlg._('Home'), dlg._('Communication'),
                  dlg._('Health and Fitness'), dlg._('Services'), dlg._('Data Management')];
    let title = titles[index];
    return dlg.manager.thingpedia.getDeviceFactories(category).then((devices) => {
        devices.forEach((device) => {
            device_list.push([device.name, device.primary_kind]);
        });

        if (category === 'communication') {
            if (dlg.manager.devices.hasDevice('org.thingpedia.builtin.thingengine.phone'))
                    device_list.push([dlg._("Phone"), 'org.thingpedia.builtin.thingengine.phone']);
        }
        if (category === 'service') {
            device_list.push([dlg._("Miscellaneous"), 'org.thingpedia.builtin.thingengine.builtin']);
        }

        if (device_list.length === 0) {
            dlg.reply(dlg._("Sorry, support of %s is still in development…").format(title));
        } else {
            dlg.reply(dlg._("Here is the list of what I support for %s. Click on each of them to list their commands.").format(title));
            device_list.forEach(([name, kind]) => {
                replyOneDevice(dlg, name, kind, category);
            });
            dlg.replyButton(dlg._("Back"), JSON.stringify({ command: { type: "help", value: { value: 'generic' }}}));
        }
    });
}


module.exports = function* helpDialog(dlg, intent) {
    let name = intent.name;
    let page = intent.page;
    if (name.startsWith('tt:type.')) {
        let category = name.substr('tt:type.'.length);
        return yield getDeviceList(dlg, category, page);
    } else {
        return yield getDeviceHelp(dlg, intent.category, name, page);
    }
}
