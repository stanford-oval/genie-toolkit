// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Silei Xu <silei@stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const Helpers = require('./helpers');

module.exports = class MakeDialog extends Dialog {
    constructor() {
        super();
        this.trigger = null;
        this.query = null;
        this.action = null;
        this.count = {trigger: 0, query: 0, action: 0};
        this.current = null;
        this.json = null;
        this.expectingTypes = ['trigger', 'query', 'action'];
        this.first = null;
        this.second = null;
        this.options = [];
    }

    start() {
        this.categories = ['media', 'social-network', 'home', 'communication', 'health', 'service', 'data-management'];
        this.titles = [this._('Media'), this._('Social Networks'), this._('Home'), this._('Communication'),
            this._('Health and Fitness'), this._('Services'), this._('Data Management')];
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.expecting === ValueCategory.Command) {
                if (command.isHelp) {
                    if (command.name.startsWith("tt:type"))
                        this._getDeviceList(command.name.substr('tt:type.'.length));
                    else
                        this._getDeviceHelp(command.name);
                    return true;

                } else {
                    var channel = Object.keys(command.root)[0];
                    if (this.count[channel] === 1) {
                        this.reply(this._("Already has a %s, give me a %s or %s").format(this.expectingTypes[0], this.expectingTypes[1]));
                        this._getCategoryList();
                        return true;
                    }
                    this[channel] = command;
                    this.count[channel] += 1;
                    this.expectingTypes.splice(this.expectingTypes.indexOf(channel), 1)

                    if (this.count.trigger + this.count.query + this.count.action === 2) {
                        // execute
                        this.json = JSON.parse("\{\"rule\": \{\}\}");
                        for (var cmd of ['trigger', 'query', 'action'])
                            if (this[cmd] !== null)
                                this.json.rule[cmd] = this[cmd].root[cmd];
                        this._handleArgs();
                        return true;
                    }
                    // take next command
                    this.ask(ValueCategory.Command, this._("Give me another command."));
                    this._getCategoryList();
                    return true;
                }
            }

            if (this.expecting === ValueCategory.MultipleChoice) {
                return this._handleResolve(command);
            }

            if (command.name === 'rule')
                return this._handleMakeRule();
            return true;
        });
    }

    _handleMakeRule() {
        this.ask(ValueCategory.Command, this._("Give me a command."));
        this._getCategoryList();
        return true;
    }

    _handleArgs() {
        var promises = [
            this._getSchema(this.trigger, 'triggers'),
            this._getSchema(this.query, 'queries'),
            this._getSchema(this.action, 'actions')
        ];

        return Q.all(promises).then(() => {
            if (this.trigger != null) {
                this.first = this.trigger;
                if (this.query != null)
                    this.second = this.query;
                else
                    this.second = this.action;
            } else {
                this.first = this.query;
                this.second = this.action;
            }
            this._handleArgMatching();
            return true;
        }).catch((e) => {
            console.log(e.stack);
            this.fail(e.message);
            return this.switchToDefault();
        });
    }

    _handleArgMatching() {
        this.ask(ValueCategory.MultipleChoice, this._("Do you want to: "));
        var k = 0;
        for (var i = 0; i < this.first.schema.args.length; i++) {
            for (var j = 0; j < this.second.schema.args.length; j ++ ) {
                if (String(this.first.schema.schema[i]) === String(this.second.schema.schema[j])) {
                    this.replyChoice(k, "option",
                        this._("use %s from command ‘%s’ as %s in command ‘%s’").format(
                            this.first.schema.args[i],
                            this.first.schema.confirmation,
                            this.second.schema.args[j],
                            this.second.schema.confirmation
                        ));
                    k++;
                    this.options.push(JSON.stringify({
                        type: "VarRef",
                        operator: "is",
                        value: {id: "tt:param." + this.first.schema.args[i]},
                        name: {id: "tt:param." + this.second.schema.args[j]}
                    }));
                }
            }
        }
        this.replyChoice(k, "options", this._("No"));
        return true;
    }

    _getSchema(obj, what) {
        if (obj === null)
            return Q();
        return this.manager.schemas.getMeta(obj.kind, what, obj.channel).then((schema) => {
            obj.schema = schema;
        });
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) ||
            value < 0 ||
            value > this.options.length) {
            this.reply(this._("Please click on one of the provided choices."));
            return true;
        } else if (value !== this.options.length) {
            if (this.second === this.query)
                this.json.rule.query["args"].push(JSON.parse(this.options[value]));
            else
                this.json.rule.action["args"].push(JSON.parse(this.options[value]));
        }
        this.manager.handleParsedCommand(JSON.stringify(this.json));
        return this.switchToDefault();
    }

    _replyOneCategory(title, category) {
        return this.replyButton(title, JSON.stringify({command: {type: 'help', value: {id: 'tt:type.' + category}}}));
    }

    _replyOneDevice(title, kind) {
        return this.replyButton(title, JSON.stringify({ command: { type: 'help', value: { id: 'tt:device.' + kind }}}));
    }

    _getCategoryList() {
        this.reply(this._("Pick one from the following categories or simply type in."));
        for (var i = 0; i < 7; i++) {
            this._replyOneCategory(this.titles[i], this.categories[i]);
        }
    }

    _getDeviceList(category) {
        var device_list = [];
        var index = this.categories.indexOf(category);
        if (index < 0) {
            this.reply(this._("No category %s.").format(category));
            return this.switchToDefault();
        }
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

            this.reply(this._("Pick a command from the following devices"));
            device_list.forEach((device) => {
                this._replyOneDevice(device[0], device[1]);
            });
        });
    }

    _getDeviceHelp(name) {
        return this.manager.thingpedia.getExamplesByKinds([name], true).then((examples) => {
            if (examples.length === 0)
                return false;
            this.reply(this._("Pick a command below.").format(name));
            var withSlot = true;
            examples = Helpers.filterExamplesByTypes(examples, this.expectingTypes, withSlot);
            if (examples.length === 0)
                return false;
            return Helpers.augmentExamplesWithSlotTypes(this.manager.schemas, examples).then(() => {
                Helpers.presentExampleList(this, examples);
                return true;
            });
        }).then((response) => {
            if (!response) {
                this.reply(this._("Can't find a satisfactory command for %s, choose another device").format(name));
                this._getCategoryList();
            }
            return true;
        });
    }

};