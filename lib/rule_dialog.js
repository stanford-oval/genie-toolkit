// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
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
const DeviceChoiceDialog = require('./device_choice_dialog');
const SlotFillingDialog = require('./slot_filling_dialog');
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');
const Codegen = require('./codegen');

function regexify(str) {
    return str.toLowerCase().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

module.exports = class RuleDialog extends Dialog {
    constructor() {
        super();

        this.trigger = null;
        this.query = null;
        this.action = null;
    }

    _computeIcon() {
        if (this.action) {
            if (this.action.device)
                return this.action.device.kind;
            if (this.action.kind === 'phone')
                return 'org.thingpedia.builtin.thingengine.phone';
        } else {
            if (this.query.device)
                return this.query.device.kind;
            if (this.query.kind === 'phone')
                return 'org.thingpedia.builtin.thingengine.phone';
        }
        if (this.trigger.device)
            return this.trigger.device.kind;
        if (this.trigger.kind === 'phone')
            return 'org.thingpedia.builtin.thingengine.phone';
        return null;
    }

    describe() {
        if (this.action) {
            return this._("%s if %s").format(Codegen.describeAction(this, this.action.kind,
                                                                    this.action.channel,
                                                                    this.action.schema,
                                                                    this.action.resolved_args,
                                                                    this.action.resolved_conditions),
                                             Codegen.describeTrigger(this, this.trigger.kind,
                                                                     this.trigger.channel,
                                                                     this.trigger.schema,
                                                                     this.trigger.resolved_args,
                                                                     this.trigger.resolved_conditions));
        } else {
            return this._("%s if %s").format(Codegen.describeAction(this, this.query.kind,
                                                                    this.query.channel,
                                                                    this.query.schema,
                                                                    this.query.resolved_args,
                                                                    this.query.resolved_conditions),
                                             Codegen.describeTrigger(this, this.trigger.kind,
                                                                     this.trigger.channel,
                                                                     this.trigger.schema,
                                                                     this.trigger.resolved_args,
                                                                     this.trigger.resolved_conditions));
        }
    }

    execute() {
        this.manager.stats.hit('sabrina-confirm');
        return Q.try(() => {
            return Codegen.codegenRule(this.manager.schemas, this.trigger, this.query, this.action);
        }).then((code) => {
            var name;
            if (this.action) {
                name = Codegen.capitalizeSelector(this.trigger.kind, this.trigger.channel) + ' to ' +
                    Codegen.capitalizeSelector(this.action.kind, this.action.channel);
            } else {
                name = Codegen.capitalizeSelector(this.trigger.kind, this.trigger.channel) + ' to ' +
                    Codegen.capitalizeSelector(this.query.kind, this.query.channel);
            }
            return this.manager.apps.loadOneApp(code, { $icon: this.icon }, undefined, undefined,
                                                name, this.describe(), true);
        }).then(() => {
            return this.done();
        }).catch((e) => {
            this.reply(this._("Sorry, that did not work: %s.").format(e.message));
            console.error(e.stack);
            return this.switchToDefault();
        });
    }

    _getSchema(obj, what) {
        if (obj === null)
            return Q();
        return this.manager.schemas.getMeta(obj.kind, what, obj.channel).then((schema) => {
            obj.schema = schema;
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

            if (this.trigger === null) {
                this.trigger = command.trigger;
                this.trigger.resolved_args = null;
                this.trigger.resolved_conditions = null;
                this.trigger.resolved_scope = null;
                this.query = command.query;
                if (this.query != null) {
                    this.query.resolved_args = null;
                    this.query.resolved_conditions = null;
                    this.query.resolved_scope = null;
                }
                this.action = command.action;
                if (this.action != null) {
                    this.action.resolved_args = null;
                    this.action.resolved_conditions = null;
                }

                var promises = [
                    this._getSchema(command.trigger, 'triggers'),
                    this._getSchema(command.query, 'queries'),
                    this._getSchema(command.action, 'actions')
                ];

                return Q.all(promises).then(() => {
                    return this._continue();
                }).catch((e) => {
                    console.log(e.stack);
                    this.fail(e.message);
                    return this.switchToDefault();
                });
            } else if (this.trigger.schema === null) {
                // still in process of loading the schema, ignore...
                return true;
            } else {
                return this._continue(command);
            }
        });
    }

    _continue(command) {
        return DeviceChoiceDialog.chooseDevice(this, this.trigger).then((waiting) => {
            if (waiting)
                return true;
            this.icon = this._computeIcon();

            if (this.query)
                return DeviceChoiceDialog.chooseDevice(this, this.query);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;
            this.icon = this._computeIcon();

            if (this.action)
                return DeviceChoiceDialog.chooseDevice(this, this.action);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;

            return SlotFillingDialog.slotFill(this, this.trigger, false, this.trigger.slots, {});
        }).then((waiting) => {
            if (waiting)
                return true;

            if (this.query)
                return SlotFillingDialog.slotFill(this, this.query, false, this.query.slots, this.trigger.resolved_scope);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;

            if (this.action)
                return SlotFillingDialog.slotFill(this, this.action, true, this.action.slots, this.trigger.resolved_scope);
            else
                return false;
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
                return this.ask(ValueCategory.YesNo, this._("Ok, so you want me to %s. Is that right?").format(this.describe()));
            }
        });
    }
}
