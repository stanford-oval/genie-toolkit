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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

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
        this.count = 0;
        this.ready = false;
        this.json = null;
        this.choices = ['trigger', 'query', 'action', 'filter', 'execute'];
        this.utterances = ['', '', '', '', ''];
        this.filterDescription = ['', '', '', '', ''];
        this.filterCandidates = [[], [], []];
        this.filters = [[], [], []];

        this.first = null;
        this.second = null;
        this.third = null;

        this._commandClass = null;
        this._currentCategory = null;
        this._helpState = null;
        this._currentFilter = null;
    }

    start() {
        this.categories = ['media', 'social-network', 'home', 'communication', 'health', 'service', 'data-management'];
        this.titles = [this._('Media'), this._('Social Networks'), this._('Home'), this._('Communication'),
            this._('Health and Fitness'), this._('Services'), this._('Data Management')];
        this.labels = [this._('When'), this._("Get"), this._("Do"), this._("Add a filter"), this._("Run it")];
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

            if (command.name === 'rule') {
                return this._handleMakeRule();
            }

            if (this.expecting === ValueCategory.MultipleChoice) {
                if (this._helpState === 'filterCommandList') {
                    if (command.value < 0 || command.value > 3)
                        return this.unexpected();
                    if (command.value === 3)
                        return this._handleBack();
                    this._commandClass = this.choices[command.value];
                    return this._getFilterList();
                } else {
                    if (command.value < 0 || command.value > (this.ready ? 4 : 2))
                        return this.unexpected();
                    if (command.value === 4) {
                        this.json = {};
                        for (var cmd of ['trigger', 'query', 'action'])
                            if (this[cmd] !== null) {
                                this.json[cmd] = this[cmd].root[cmd];
                                this._applyFilters(cmd);
                            }
                        if (Object.keys(this.json).length > 1)
                            this.json = {'rule': this.json};
                        return this._handleArgs();
                    } else if (command.value === 3) {
                        return this._handleFilters();
                    } else {
                        this._commandClass = this.choices[command.value];
                        return this._handleRuleCategory(this.choices[command.value]);
                    }
                }
            }

            if (this.expecting === ValueCategory.Command) {
                if (command.isBack)
                    return this._handleBack();

                if (command.isHelp) {
                    if (command.name.startsWith("tt:type"))
                        return this._getDeviceList(command.name.substr('tt:type.'.length));
                    else {
                        return this._getDeviceHelp(command.name, command.page);
                    }
                }

                if (command.isTrigger || command.isAction || command.isQuery || command.isEmpty) {
                    var channel = this._commandClass;
                    if (this[channel] === null) this.count += 1;
                    if (command.isEmpty) this.count -= 1;
                    if (this.count >= 1) this.ready = true;

                    if (!command.isEmpty) {
                        this[channel] = command;
                        return this._handleSelected();
                    } else {
                        this[channel] = null;
                        if (channel === 'trigger') this.utterances[0] = ": now";
                        else if (channel === 'action') this.utterances[2] = ": notify me";
                        this._cleanFilters();
                        return this._handleMakeRule();
                    }
                }

                if (command.isFilter) {
                    var filter = command.root.filter;
                    if (filter.value === null) {
                        this._currentFilter = filter;
                        var question = "What's the value of this filter?";
                        switch (filter.type) {
                            case 'String': return this.ask(ValueCategory.RawString, question);
                            case 'Number': return this.ask(ValueCategory.Number, question);
                            case 'Measure': return this.ask(ValueCategory.Measure(filter.unit), question);
                            case 'Entity(tt:email_address)': return this.ask(ValueCategory.EmailAddress, question);
                            case 'Entity(tt:phone_number)': return this.ask(ValueCategory.PhoneNumber, question);
                            default: throw new Error('Unexpected argument type');
                        }
                    }
                    var idx = this.choices.indexOf(this._commandClass);
                    this._addFilter(idx, filter);
                    return this._handleMakeRule();
                }
            }

            if (this.expecting === ValueCategory.Number || this.expecting === ValueCategory.EmailAddress ||
                this.expecting === ValueCategory.PhoneNumber) {
                var filter = this._currentFilter;
                this._currentFilter = null;
                filter.value = command.value.value;
                var idx = this.choices.indexOf(this._commandClass);
                this._addFilter(idx, filter);
                return this._handleMakeRule();
            }

            if (this.expecting.isMeasure) {
                var filter = this._currentFilter;
                this._currentFilter = null;
                filter.value = command.value.value;
                filter.unit = command.value.unit;
                var idx = this.choices.indexOf(this._commandClass);
                this._addFilter(idx, filter);
                return this._handleMakeRule();
            }

            return true;
        });
    }

    _handleMakeRule() {
        this._helpState = null;
        var hint = this.ready ? this._("Edit your rule or run it") : this._("Edit your rule");
        this.ask(ValueCategory.MultipleChoice, hint);
        for (var i = 0; i < (this.ready ? 5 : 3); i++) {
            this.replyChoice(i, "choice", this.labels[i] + this.utterances[i] + this.filterDescription[i]);
        }
        return true;
    }

    _handleSelected() {
        var promises = [];
        switch(this._commandClass) {
            case 'trigger': promises.push(this._getSchema(this.trigger, 'triggers')); break;
            case 'query': promises.push(this._getSchema(this.query, 'queries')); break;
            case 'action': promises.push(this._getSchema(this.action, 'actions')); break;
        }
        return Q.all(promises).then(() => {
            var canonical = this[this._commandClass].schema.canonical;
            var idx = this.choices.indexOf(this._commandClass);
            if (idx === 0 && canonical.startsWith("when ")) canonical = canonical.substr("when ".length);
            if (idx === 0 && canonical.startsWith("if ")) canonical = canonical.substr("if ".length);
            if (idx === 0 && canonical.startsWith("whenever ")) canonical = canonical.substr("whenever ".length);
            if (idx === 1 && canonical.startsWith("get ")) canonical = canonical.substr("get ".length);
            if (idx === 1 && canonical.startsWith("show ")) canonical = canonical.substr("show ".length);
            this.utterances[idx] = ": " + canonical;
            this._cleanFilters();
            this._addFilterCandidates();
            this._addFiltersFromJson();
            return this._handleMakeRule();
        }).catch((e) => {
            console.log(e.stack);
            this.fail(e.message);
            return this.switchToDefault();
        });
    }

    _handleRuleCategory() {
        this.expect(ValueCategory.Command);
        return this._getCategoryList();
    }

    _handleBack() {
        switch (this._helpState) {
            case 'categoryList': return this._handleMakeRule();
            case 'deviceList': return this._getCategoryList();
            case 'commandList': return this._getDeviceList(this._currentCategory);

            case 'filterCommandList': return this._handleMakeRule();
            case 'filterList': return this._handleFilters();

            default: throw new Error('Unexpected help state');
        }
    }

    _handleFilters() {
        this._helpState = 'filterCommandList';
        if (this.filterCandidates[0].length + this.filterCandidates[1].length + this.filterCandidates[2].length === 0) {
            this.reply("There is nothing to filter.");
            return this._handleMakeRule();
        }
        this.ask(ValueCategory.MultipleChoice, "Pick the command you want to add filters to:");
        for (var i = 0; i < 3; i++) {
            if (this.filterCandidates[i].length > 0)
                this.replyChoice(i, "choice", this.labels[i] + this.utterances[i]);
        }
        this.replyChoice(i, "choice", "Back");
        return true;
    }

    _getFilterList() {
        this._helpState = 'filterList';
        this.ask(ValueCategory.Command, "Pick the filter you want to add:");
        var idx = this.choices.indexOf(this._commandClass);
        this.filterCandidates[idx].forEach((filter, i) => {
            this.replyButton(
                [filter.name, filter.operator, "____"].join(' '),
                JSON.stringify({filter: filter})
            );
        });
        this._replyBack();
        return true;
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
        if (this._commandClass === 'trigger')
            return this.replyButton(this._("Do it now"), special);
        if (this._commandClass === 'action')
            return this.replyButton(this._("Just notify me"), special);
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

    _getDeviceHelp(name, page) {
        this._helpState = 'commandList';
        return this.manager.thingpedia.getExamplesByKinds([name], true).then((examples) => {
            if (examples.length === 0)
                return false;
            this.reply(this._("Pick a command below.").format(name));
            var withSlot = true;
            examples = Helpers.filterExamplesByTypes(examples, [this._commandClass], withSlot);
            if (examples.length === 0)
                return false;
            return Helpers.augmentExamplesWithSlotTypes(this.manager.schemas, examples).then(() => {
                var hasMore = examples.length > (page + 1) * 5;
                examples = examples.slice(page * 5, (page + 1) * 5);
                Helpers.presentExampleList(this, examples);
                if (hasMore)
                    this.replyButton(this._("More…"), JSON.stringify({ command: { type: "help", value: { id: "tt:device." + name }, page: page + 1 } }));
                if (page > 0)
                    this.replyButton(this._("Back"), JSON.stringify({ command: { type: "help", value: { id: "tt:device." + name }, page: page - 1 } }));
                else
                    this._replyBack();
                return true;
            });
        }).then((response) => {
            if (!response) {
                this.reply(this._("Can't find a compatible command from %s, choose another device").format(name));
                return this._replyBack();
            } else {
                return true;
            }
        });
    }

    _addFilterCandidates() {
        if (this[this._commandClass] !== null) {
            var schema = this[this._commandClass].schema;
            var i = this.choices.indexOf(this._commandClass);
            schema.schema.forEach((type, j) => {
                if (type.isString) {
                    this.filterCandidates[i].push({
                        type: "String",
                        operator: "is",
                        name: schema.args[j],
                        value: null
                    });
                    this.filterCandidates[i].push({
                        type: "String",
                        operator: "contains",
                        name: schema.args[j],
                        value: null
                    });
                } else if (type.isNumber) {
                    this.filterCandidates[i].push({
                        type: "Number",
                        operator: "is",
                        name: schema.args[j],
                        value: null
                    });
                    this.filterCandidates[i].push({
                        type: "Number",
                        operator: "<",
                        name: schema.args[j],
                        value: null
                    });
                    this.filterCandidates[i].push({
                        type: "Number",
                        operator: ">",
                        name: schema.args[j],
                        value: null
                    });
                } else if (type.isMeasure) {
                    this.filterCandidates[i].push({
                        type: "Measure",
                        operator: "is",
                        name: schema.args[j],
                        value: null,
                        unit: type.unit
                    });
                    this.filterCandidates[i].push({
                        type: "Measure",
                        operator: "<",
                        name: schema.args[j],
                        value: null,
                        unit: type.unit
                    });
                    this.filterCandidates[i].push({
                        type: "Measure",
                        operator: ">",
                        name: schema.args[j],
                        value: null,
                        unit: type.unit
                    });
                } else if (type.isEntity && type.type === "tt:email_address") {
                    this.filterCandidates[i].push({
                        type: "Entity(tt:email_address)",
                        operator: "is",
                        name: schema.args[j],
                        value: null
                    })
                } else if (type.isEntity && type.type === "tt:phone_number") {
                    this.filterCandidates[i].push({
                        type: "Entity(tt:phone_number)",
                        operator: "is",
                        name: schema.args[j],
                        value: null
                    })
                }
            })
        }
    }

    _applyFilters(channel) {
        var idx = this.choices.indexOf(channel);
        this.filters[idx].forEach((filter) => {
            var arg = {
                name: {id: "tt:param." + filter.name},
                type: filter.type,
                value: {value: filter.value},
                operator: filter.operator
            };
            if (filter.type === "Measure")
                arg.value.unit = filter.unit;
            this.json[channel].args.push(arg);
        });
    }

    _addFilter(i, filter) {
        var idxConflict = -1;
        if (filter.operator === "is") {
            this.filters[i].forEach((f, idx) => {
                if (f.name === filter.name && f.operator === "is")
                    idxConflict = idx;
            });
        }
        if (idxConflict === -1) {
            this.filters[i].push(filter);
            this.filterDescription[i] += ", " + this._describeFilter(filter);
        } else {
            var old = this.filters[i][idxConflict];
            this.filterDescription[i] = this.filterDescription[i].replace(
                this._describeFilter(old), this._describeFilter(filter)
            );
            this.filters[i][idxConflict].value = filter.value;
            if (filter.type === "Measure")
                this.filters[i][idxConflict].unit = filter.unit;
        }

    }

    _addFiltersFromJson() {
        var channel = this._commandClass;
        var idx = this.choices.indexOf(channel);
        var json = this[channel].root;
        json[channel].args.forEach((arg) => {
            var filter = {
                name: arg.name.id.substr("tt:param.".length),
                type: arg.type,
                operator: arg.operator,
                value: arg.value.value
            };
            if (arg.type === "Measure")
                filter.unit = arg.value.unit;
            this._addFilter(idx, filter);
        });
        // drop all the args and add them back later along with other filters
        // so that no duplicate check is needed when adding other filters
        json[channel].args = [];
    }


    _describeFilter(filter) {
        if (filter.type === "Measure")
            return [filter.name, filter.operator, filter.value, filter.unit].join(' ');
        else
            return [filter.name, filter.operator, filter.value].join(' ');
    }

    _handleArgs() {
        var promises = [
            this._getSchema(this.trigger, 'triggers'),
            this._getSchema(this.query, 'queries'),
            this._getSchema(this.action, 'actions')
        ];

        return Q.all(promises).then(() => {
            if (this.count === 3) {
                this.first = this.trigger;
                this.second = this.query;
                this.third = this.action;
                this._handleArgMatching();
            } else if (this.count === 2) {
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

    _cleanFilters() {
        var idx = this.choices.indexOf(this._commandClass);
        this.filters[idx] = [];
        this.filterCandidates[idx] = [];
        this.filterDescription[idx] = "";
    }

    _getSchema(obj, what) {
        if (obj === null || obj.isEmpty)
            return Q();
        return this.manager.schemas.getMeta(obj.kind, what, obj.channel).then((schema) => {
            obj.schema = schema;
        });
    }

    handleRaw(raw) {
        // handle raw input for filter values
        if (this.expecting === ValueCategory.RawString) {
            var filter = this._currentFilter;
            this._currentFilter = null;
            filter.value = Ast.Value.String(raw).value;
            var idx = this.choices.indexOf(this._commandClass);
            this._addFilter(idx, filter);
            return this._handleMakeRule();
        }
    }
};