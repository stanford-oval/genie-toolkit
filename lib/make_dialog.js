// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
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

function argToEnglish(str) {
    return str.replace(/([A-Z])/g, ' $1').toLowerCase().replace('_', ' ');
}

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
        this.third = null;

        this._commandClass = null;
        this._numEmpty = 0;

        // could be categoryList - deviceList - commandList
        this._currentCategory = null;
        this._helpState = null;
    }

    start() {
        this.categories = ['media', 'social-network', 'home', 'communication', 'health', 'service', 'data-management'];
        this.titles = [this._('Media'), this._('Social Networks'), this._('Home'), this._('Communication'),
            this._('Health and Fitness'), this._('Services'), this._('Data Management')];
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled) {
                // a workaround for missing sendAskSpecial('command')
                if (this.expecting === ValueCategory.Command &&
                    command.json === "\{\"special\":\"tt:root.special.help\"\}")
                    this._getCategoryList();
                return true;
            }

            if (this.expecting === ValueCategory.MultipleChoice) {
                if (command.value < 0 || command.value > this._choices.length)
                    return this.unexpected();

                this._commandClass = this._choices[command.value];
                this._choices = null;
                return this._handleRuleCategory();
            }

            if (this.expecting === ValueCategory.Command) {
                if (command.isBack) {
                    switch (this._helpState) {
                    case 'categoryList':
                        return this._expectNext();

                    case 'deviceList':
                        return this._getCategoryList();

                    case 'commandList':
                        return this._getDeviceList(this._currentCategory);

                    default:
                        throw new Error('Unexpected help state');
                    }
                }

                if (command.isHelp) {
                    if (command.name.startsWith("tt:type"))
                        return this._getDeviceList(command.name.substr('tt:type.'.length));
                    else
                        return this._getDeviceHelp(command.name);

                } else if (command.isTrigger || command.isAction || command.isQuery || command.isEmpty) {
                    var channel = command.isEmpty ? this._commandClass : Object.keys(command.root)[0];
                    if (this.count[channel] === 1) {
                        this.reply(this._("Already has a %s, give me a %s or %s").format(this.expectingTypes[0], this.expectingTypes[1]));
                        return this._getCategoryList();
                    }
                    this.count[channel] += 1;
                    this.expectingTypes.splice(this.expectingTypes.indexOf(channel), 1);
                    if (command.isEmpty)
                        this._numEmpty += 1;
                    else
                        this[channel] = command;

                    if (this.count.trigger + this.count.query + this.count.action === 3) {
                        // execute
                        this.json = {};
                        for (var cmd of ['trigger', 'query', 'action'])
                            if (this[cmd] !== null)
                                this.json[cmd] = this[cmd].root[cmd];
                        if (Object.keys(this.json).length > 1)
                            this.json = {'rule': this.json};
                        this._handleArgs();
                        return true;
                    }

                    // take next command
                    return this._expectNext();
                } else {
                    this.reply(this._("That's not what I want, give me a trigger, a query, or an action."));
                    return this._getCategoryList();
                }
            }

            if (command.name === 'rule') {
                return this._expectNext();
            }

            return true;
        });
    }

    _expectNext() {
        var expect = [];
        if (this.count.trigger === 0) expect.push('trigger');
        if (this.count.query === 0) expect.push('query');
        if (this.count.action === 0) expect.push('action');
        return this._handleMakeRule(expect);
    }

    _handleMakeRule(expect) {
        this.ask(ValueCategory.MultipleChoice, this._("Pick a command category:"));

        const LABELS = {
            'trigger': this._("When"),
            'query': this._("Get"),
            'action': this._("Do")
        };

        this._choices = expect;
        for (var i = 0; i < this._choices.length; i++) {
            this.replyChoice(i, "choice", LABELS[this._choices[i]]);
        }
        return true;
    }

    _handleRuleCategory() {
        this.expect(ValueCategory.Command);
        return this._getCategoryList();
    }

    _handleArgs() {
        var promises = [
            this._getSchema(this.trigger, 'triggers'),
            this._getSchema(this.query, 'queries'),
            this._getSchema(this.action, 'actions')
        ];

        return Q.all(promises).then(() => {
            if (this._numEmpty === 0) {
                this.first = this.trigger;
                this.second = this.query;
                this.third = this.action;
                this._handleArgMatching();
            } else if (this._numEmpty === 1) {
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
            } else if (this._numEmpty === 2) {
                // primitive commands, no need to handle argument matching
            }
            this.switchToDefault();
            // handle it at the next mainloop iteration to avoid reentrancy
            setImmediate(() => {
                this.manager.handleParsedCommand(JSON.stringify(this.json));
            });
            return true;
        }).catch((e) => {
            console.log(e.stack);
            this.fail(e.message);
            return this.switchToDefault();
        });
    }

    _handleArgMatching() {
        this.second.schema['options'] = [];
        for (var i = 0; i < this.second.schema.args.length; i++) {
            var options = [];
            for (var j = 0; j < this.first.schema.args.length; j ++ ) {
                if (String(this.first.schema.schema[j]) === String(this.second.schema.schema[i])) {
                    options.push({
                        name: this.second.schema.args[i],
                        value: this.first.schema.args[j],
                        text: this._("Use the %s from %s").format(argToEnglish(this.first.schema.args[j]), this.first.kind)
                    });
                }
            }
            this.second.schema["options"].push(options);
        }
        if (this.third !== null) {
            this.third.schema['options'] = [];
            for (var i = 0; i < this.third.schema.args.length; i++) {
                var options = [];
                for (var j = 0; j < this.first.schema.args.length; j ++ ) {
                    if (String(this.first.schema.schema[j]) === String(this.third.schema.schema[i])) {
                        options.push({
                            name: this.third.schema.args[i],
                            value: this.first.schema.args[j],
                            text: this._("Use the %s from %s").format(argToEnglish(this.first.schema.args[j]), this.first.kind)
                        });
                    }
                }
                for (var j = 0; j < this.second.schema.args.length; j ++ ) {
                    if (String(this.second.schema.schema[j]) === String(this.third.schema.schema[i])) {
                        options.push({
                            name: this.third.schema.args[i],
                            value: this.second.schema.args[j],
                            text: this._("Use the %s from %s").format(argToEnglish(this.second.schema.args[j]), this.second.kind)
                        });
                    }
                }
                this.third.schema["options"].push(options);
            }
        }
        return true;
    }

    _getSchema(obj, what) {
        if (obj === null || obj.isEmpty)
            return Q();
        return this.manager.schemas.getMeta(obj.kind, what, obj.channel).then((schema) => {
            obj.schema = schema;
        });
    }

    _replyOneCategory(title, category) {
        return this.replyButton(title, JSON.stringify({command: {type: 'help', value: {id: 'tt:type.' + category}}}));
    }

    _replyOneDevice(title, kind) {
        return this.replyButton(title, JSON.stringify({ command: { type: 'help', value: { id: 'tt:device.' + kind }}}));
    }

    _replyBack() {
        return this.replyButton(this._("Back"), JSON.stringify({ command: { type: 'back' }}));
    }

    _replySpecial() {
        var special =  JSON.stringify({ command: { type: 'empty' }});
        if (this._commandClass === 'trigger' && this._numEmpty < 2)
            return this.replyButton(this._("Do it now"), special);
        if (this._commandClass === 'query' && this._numEmpty < 2)
            return this.replyButton(this._("Nothing to get"), special);
        if (this._commandClass === 'action' && this._numEmpty < 2)
            return this.replyButton(this._("Just notify me"), special);
    }

    _getCategoryList() {
        this.reply(this._("Pick one from the following categories or simply type in."));
        this._replySpecial();
        for (var i = 0; i < 7; i++) {
            this._replyOneCategory(this.titles[i], this.categories[i]);
        }
        this._currentCategory = null;
        this._helpState = 'categoryList';
        this._replyBack();
        return true;
    }

    _getDeviceList(category) {
        this._currentCategory = category;
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
            this._helpState = 'deviceList';
            this._replyBack();
            return true;
        });
    }

    _getDeviceHelp(name) {
        return this.manager.thingpedia.getExamplesByKinds([name], true).then((examples) => {
            if (examples.length === 0)
                return false;
            this.reply(this._("Pick a command below.").format(name));
            var withSlot = true;
            examples = Helpers.filterExamplesByTypes(examples, [this._commandClass], withSlot);
            if (examples.length === 0)
                return false;
            return Helpers.augmentExamplesWithSlotTypes(this.manager.schemas, examples).then(() => {
                Helpers.presentExampleList(this, examples);
                return true;
            });
        }).then((response) => {
            if (!response) {
                this.reply(this._("Can't find a compatible command from %s, choose another device").format(name));
                return this._getDeviceList(this._currentCategory);
            } else {
                this._helpState = 'commandList';
                this._replyBack();
                return true;
            }
        });
    }

};
