// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const Dialog = require('./dialog');
const SlotFillingDialog = require('./slot_filling_dialog');
const DeviceChoiceDialog = require('./device_choice_dialog');
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');
const Describe = require('./describe');
const reconstruct = require('./reconstruct_canonical');

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

function makeProgram(rules) {
    var program = Ast.Program('AlmondGenerated', [], rules);
    return Ast.prettyprint(program);
}

// base class for all dialogs that generate ThingTalk for
// a specific device
// this means ActionDialog, QueryDialog and TriggerDialog
module.exports = class CodegenDialog extends Dialog {
    constructor() {
        super();

        this.originalCommand = null;

        this.kind = null;
        this.id = null;
        this.channel = null;
        this.owner = null;
        this.principal = null;
        this.schema = null;
        this.args = null;
        this.slots = null;
        this.resolved_args = null;
        this.resolved_conditions = null;
        this.device = null;
    }

    describe() {
        var description = Describe.describeAction(this, this.kind,
                                                  this.channel,
                                                  this.owner,
                                                  this.schema,
                                                  this.resolved_args,
                                                  this.resolved_conditions);
        if (this.CHANNEL_TYPE === 'triggers')
            return this._("notify if %s").format(description);
        else
            return description;
    }

    execute() {
        this.manager.stats.hit('sabrina-confirm');

        var newrules, sendrules;
        return Q.try(() => {
            // get the name, description and icon before we factor the remote rules out
            var description = this.describe();
            var name = this.prefix() + ' ' + ThingTalk.Generate.capitalizeSelector(this.kind, this.channel);
            var appMeta = { $icon: this.icon };
            if (this.fixConversation)
                appMeta.$conversation = this.manager.id;

            var rule = {
                trigger: null,
                query: null,
                action: null
            };
            if (this.CHANNEL_TYPE === 'actions')
                rule.action = this;
            else if (this.CHANNEL_TYPE === 'queries')
                rule.query = this;
            else if (this.CHANNEL_TYPE === 'triggers')
                rule.trigger = this;
            [newrules, sendrules] = ThingTalk.Generate.factorRule(this.manager.messaging, rule);

            var newttrules = newrules.map((r) => {
                return ThingTalk.Generate.codegenRule(r.trigger, r.query, r.action);
            });
            if (newttrules.length > 0) {
                var code = makeProgram(newttrules);
                return this.manager.apps.loadOneApp(code, appMeta, undefined, undefined,
                                                    name, description, true);
            }
        }).then((app) => {
            return Q.all(sendrules.map(([principal, rule]) => {
                return reconstruct(this, JSON.stringify(rule)).then((reconstructed) => {
                    this.reply(this._("Sending rule to %s: %s").format(principal, reconstructed));
                    this.manager.remote.installRuleRemote(principal, rule)
                        .catch((e) => {
                            if (app) {
                                app.reportError(e);
                                // destroy the app if the user denied it
                                this.manager.apps.removeApp(app);
                            } else {
                                console.log('Ignored error from permission control request: ' + e.code + ': ' + e.message);
                            }
                        });
                });
            }));
        }).then(() => {
            if (this.autoConfirm)
                return this.switchToDefault();
            else
                return this.done();
        }).catch((e) => {
            this.reply(this._("Sorry, that did not work: %s.").format(e.message));
            console.error(e.stack);
            return this.switchToDefault();
        });
    }

    handleRaw(raw) {
        if (this.subdialog !== null) {
            return Q(this.subdialog.handleRaw(raw)).then((handled) => {
                if (handled)
                    return true;
                else
                    return this._continue();
            });
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.args === null)
                this.args = command.args;
            if (this.slots === null)
                this.slots = command.slots;

            if (this.kind === null) {
                this.kind = command.kind;
                this.channel = command.channel;
                this.owner = command.owner;

                if (command.schema) {
                    this.schema = command.schema;
                    return this._continue();
                }

                return this.manager.schemas.getMeta(this.kind, this.CHANNEL_TYPE, this.channel).then((schema) => {
                    this.schema = schema;
                    this.kind_type = schema.kind_type;
                    console.log('Obtained schema for ' + this.kind);
                    return this._continue();
                });
            } else if (this.schema === null) {
                // still in process of loading the schema, ignore...
                return true;
            } else {
                return this._continue(command);
            }
        });
    }

    _continue(command) {
        return DeviceChoiceDialog.chooseDevice(this, this).then((waiting) => {
            if (waiting)
                return true;

            this.icon = Helpers.getIcon(this);
            return SlotFillingDialog.slotFill(this, this, this.slotFillAll, this.slots, {});
        }).then((waiting) => {
            if (waiting)
                return true;

            if (this.expecting === ValueCategory.YesNo) {
                if (command.isYes)
                    return this.execute();
                else if (command.isNo)
                    return this.reset();
                else
                    return this.fail();
            } else {
                if (this.autoConfirm) {
                    return this.execute();
                } else {
                    return this.ask(ValueCategory.YesNo, this._("Ok, so you want me to %s. Is that right?").format(this.describe()));
                }
            }
        });
    }
}
