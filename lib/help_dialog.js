// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Silei Xu <silei@stanford.edu>
//
// See COPYING for details
"use strict"

const Q = require('q');
const events = require('events');

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const Helpers = require('./helpers');
const MakeDialog = require('./make_dialog');

module.exports = class HelpDialog extends Dialog {
    constructor() {
        super();
        this.name = null;
        this.page = 0;
    }

    start() {
        this.categories = ['media', 'social-network', 'home', 'communication', 'health', 'service', 'data-management'];
        this.titles = [this._('Media'), this._('Social Networks'), this._('Home'), this._('Communication'),
            this._('Health and Fitness'), this._('Services'), this._('Data Management')];
    }

    _getAppHelp() {
        return this.manager.thingpedia.getApps(this.page * 5, 6).then((apps) => {
            var hasMore = apps.length > 5;
            apps.forEach((app) => {
                this.replyButton(app.name, JSON.stringify({ action: { name: { id: 'tt:' + app.app_id + '.invoke' }, args: [] }}));
            });
            if (hasMore)
                this.replyButton(this._("More…"), JSON.stringify({ command: { type: "help", value: { id: "tt:type.apps" }, page: this.page + 1 } }));
            this.replyButton(this._("Back"), JSON.stringify({ command: { type: "help", value: { value: 'generic' }}}));
            return this.switchToDefault();
        });
    }

    _getDeviceHelp(category) {
        return this.manager.thingpedia.getExamplesByKinds([this.name], true).then((examples) => {
            if (examples.length === 0) {
                return false;
            }
            this.reply(this._("Here's what I can do for you on %s.").format(this.name));

            examples = Helpers.filterExamples(examples);
            return Helpers.augmentExamplesWithSlotTypes(this.manager.schemas, examples).then(() => {
                var hasMore = examples.length > (this.page + 1) * 5;
                examples = examples.slice(this.page * 5, (this.page + 1) * 5);
                Helpers.presentExampleList(this, examples);
                if (hasMore)
                    this.replyButton(this._("More…"), JSON.stringify({ command: { type: "help", value: { id: "tt:device." + this.name }, page: this.page + 1 } }));
                if (this.page > 0)
                    this.replyButton(this._("Back"), JSON.stringify({ command: { type: "help", value: { id: "tt:device." + this.name }, page: this.page - 1 } }));
                else if (category)
                    this.replyButton(this._("Back"), JSON.stringify({ command: { type: "help", value: { id: "tt:type." + category }}}));
                else
                    this.replyButton(this._("Back"), JSON.stringify({ command: { type: "help", value: { value: 'generic' }}}));
                return true;
            });
        }).then((response) => {
            if (!response) {
                // should never get here for non-developers
                this.reply(this._("There is no example commands for %s.").format(this.name));
                this.reply(this._("Try add examples at https://thingengine.stanford.edu/thingpedia/devices if you are testing as a developer."));
            }

            return this.switchToDefault();
        });
    }

    _replyOneDevice(title, kind, category) {
        return this.replyButton(title, JSON.stringify({ command: { type: 'help', value: { id: 'tt:device.' + kind }, category: category }}));
    }

    _replyOneCategory(title, category) {
        return this.replyButton(title, JSON.stringify({command: {type: 'help', value: {id: 'tt:type.' + category}}}));
    }

    _getCategoryList() {
        this.reply(this._("Here is a list of what I can do. Click on each of the categories to see corresponding devices."));
        for (var i = 0; i < 7; i++) {
            this._replyOneCategory(this.titles[i], this.categories[i]);
        }
        this.replyButton(this._("Make Your Own Rule"), JSON.stringify({special: 'tt:root.special.makerule'}));
        return this.switchToDefault();
    }

    _getDeviceList(category) {
        if (category === 'apps')
            return this._getAppHelp();

        var device_list = new Array();
        var index = this.categories.indexOf(category);
        if (index < 0) {
            this.reply(this._("No category %s.").format(category));
            return this.switchToDefault();
        }
        var title = this.titles[index];
        return this.manager.thingpedia.getDeviceFactories(category).then((devices) => {
            devices.forEach((device) => {
                if (!device.global_name)
                    return;
                device_list.push([device.name, device.global_name]);
            });

            if (category === 'communication')
                if (this.manager.devices.hasDevice('org.thingpedia.builtin.thingengine.phone'))
                    device_list.push([this._("Phone"), 'phone']);
            if (category === 'service')
                device_list.push([this._("Miscellaneous"), 'builtin']);


            if (device_list.length === 0) {
                this.reply(this._("Sorry, support of %s is still in development…").format(title));
                return this.switchToDefault();
            } else {
                this.reply(this._("Here is the list of what I support for %s. Click on each of them to list their commands.").format(title));
                device_list.forEach((device) => {
                    this._replyOneDevice(device[0], device[1], category);
                });
                this.replyButton(this._("Back"), JSON.stringify({ command: { type: "help", value: { value: 'generic' }}}));
            }

            return this.switchToDefault();
        });
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;
            this.name = command.name;
            this.page = command.page;
            if (this.name.startsWith('tt:type.')) {
                var category = this.name.substr('tt:type.'.length);
                return this._getDeviceList(category);
            } else {
                return this._getDeviceHelp(command.category);
            }
        });
    }
}
