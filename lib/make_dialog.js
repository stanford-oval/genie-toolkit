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
const RuleDialog = require('./rule_dialog');

module.exports = class MakeDialog extends Dialog {
    constructor() {
        super();
        this.trigger = null;
        this.query = null;
        this.action = null;
        this.count = {trigger: 0, query: 0, action: 0};
        this.current = null;
        this.json = null;
        this.argJson = null;
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.expecting === ValueCategory.Command) {
                var channel = Object.keys(command.root)[0];
                if (this.count[channel] === 1) {
                    this.reply("already has a ", channel);
                    return this.ask(ValueCategory.Command, "try again");
                }
                this[channel] = command;
                this.count[channel] += 1;

                if (this.count.trigger + this.count.query + this.count.action === 2) {
                    // execute
                    this.json = JSON.parse("\{\"rule\": \{\}\}");
                    for (var cmd of ['query', 'action', 'trigger'])
                        if (this[cmd] !== null)
                            this.json.rule[cmd] = this[cmd].root[cmd];
                    this._handleArgs();

                }
                // take next command
                return this.ask(ValueCategory.Command, this._("Give me another command."));
            }

            if (this.expecting === ValueCategory.MultipleChoice) {
                console.log(command);
                this._handleArgMatching(command);
            }

            if (command.name === 'rule')
                return this._handleMakeRule();
            return true;
        });
    }

    _handleMakeRule() {
        return this.ask(ValueCategory.Command, this._("Give me a command."));
    }

    _handleArgs() {
        var promises = [
            this._getSchema(this.trigger, 'triggers'),
            this._getSchema(this.query, 'queries'),
            this._getSchema(this.action, 'actions')
        ];

        return Q.all(promises).then(() => {
            if (this.trigger != null)
                this.current = this.trigger;
            else
                this.current = this.query;
            this._handleArgMatching();
            return true;
        }).catch((e) => {
            console.log(e.stack);
            this.fail(e.message);
            return this.switchToDefault();
        });
    }

    _handleArgMatching(command) {
        if (command === undefined) {
            this.ask(ValueCategory.MultipleChoice, "What parameter do you want to link?");
            for (var i = 0; i < this.current.schema.args.length; i++) {
                this.replyChoice(i, "arg", this.current.schema.args[i]);
            }
            if (this.argJson === null)
                this.replyChoice(i, "arg", "No parameter linking needed.");
        } else {
            if (this._handleResolve(command))
                return true;

            if (this.done === true) {
                this.manager.handleParsedCommand(JSON.stringify(this.json));
                return this.switchToDefault();
            }
        }

    }

    _getSchema(obj, what) {
        if (obj === null)
            return Q();
        return this.manager.schemas.getMeta(obj.kind, what, obj.channel).then((schema) => {
            obj.schema = schema;
            console.log(schema);
        });
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) ||
            value < 0 ||
            value > this.current.schema.args.length) {
            this.reply(this._("Please click on one of the provided choices."));
            return true;
        } else if (value === this.current.schema.args.length) {
            this.done = true;
            return false;
        } else {
            var argName = this.current.schema.args[value];
            if (this.argJson === null) {
                this.argJson = {"type": "VarRef", "operator": "is", "value": {"id": "tt:param." + argName}};
                console.log(this.argJson);
                console.log(JSON.stringify(this.argJson));
                if (this.current === this.trigger && this.query !== null)
                    this.current = this.query;
                else
                    this.current = this.action;
                return this._handleArgMatching();
            } else {
                this.argJson["name"] = {"id":"tt:param." + argName};
                console.log(this.argJson);
                console.log(this.json);
                if (this.current === this.trigger && this.query !== null)
                    this.json.rule.query["args"].push(this.argJson);
                else
                    this.json.rule.action["args"].push(this.argJson);
                console.log(this.json);
                this.done = true;
                return false;
            }
        }
    }

};