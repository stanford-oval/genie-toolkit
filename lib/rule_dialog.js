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

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}
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

    capitalizeSelector(kind, channel) {
        if (kind === '$builtin')
            return capitalize(channel);
        else
            return capitalize(kind);
    }

    describe() {
        if (this.action) {
            return Codegen.describeAction(this.action.kind,
                                          this.action.channel,
                                          this.action.schema,
                                          this.action.resolved_args)
                + " if " +
                Codegen.describeTrigger(this.trigger.kind,
                                        this.trigger.channel,
                                        this.trigger.schema,
                                        this.trigger.resolved_args);
        } else {
            return Codegen.describeAction(this.query.kind,
                                          this.query.channel,
                                          this.query.schema,
                                          this.query.resolved_args)
                + " if " +
                Codegen.describeTrigger(this.trigger.kind,
                                        this.trigger.channel,
                                        this.trigger.schema,
                                        this.trigger.resolved_args);
        }
    }

    execute() {
        Q.try(() => {
            return Codegen.codegenRule(this.manager.schemas, this.trigger, this.query, this.action);
        }).then((code) => {
            var name;
            if (this.action) {
                name = this.capitalizeSelector(this.trigger.kind, this.trigger.channel) + ' to ' +
                    this.capitalizeSelector(this.action.kind, this.action.channel);
            } else {
                name = this.capitalizeSelector(this.trigger.kind, this.trigger.channel) + ' to ' +
                    this.capitalizeSelector(this.query.kind, this.query.channel);
            }
            this.manager.apps.loadOneApp(code, {}, undefined, undefined,
                                         name, this.describe(), true);
        }).then(() => {
            this.done();
        }).catch((e) => {
            this.reply("Sorry, that did not work: " + e.message);
            console.error(e.stack);
            this.switchToDefault();
        }).done();

        return true;
    }

    _getSchema(obj, what) {
        return this.manager.schemas.getMeta(obj.kind, what, obj.channel).then((schema) => {
            obj.schema = schema;
            return true;
        });
    }

    handleRaw(raw) {
        if (this.subdialog !== null) {
            if (this.subdialog.handleRaw(raw))
                return true;

            return this._continue();
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        if (this.trigger === null) {
            this.trigger = command.trigger;
            this.trigger.resolved_args = null;
            this.trigger.resolved_conditions = null;
            this.query = command.query;
            if (this.query != null) {
                this.query.resolved_args = null;
                this.query.resolved_conditions = null;
            }
            this.action = command.action;
            if (this.action != null) {
                this.action.resolved_args = null;
                this.action.resolved_conditions = null;
            }

            this._getSchema(command.trigger, 'triggers').then((ok) => {
                if (!ok)
                    return false;

                if (command.action)
                    return this._getSchema(command.action, 'actions');
                else
                    return true;
            }).then((ok) => {
                if (!ok)
                    return false;

                if (command.query)
                    return this._getSchema(command.query, 'queries');
                else
                    return true;
            }).then((ok) => {
                if (ok)
                    this._continue();
            }).catch((e) => {
                this.fail(e.message);
                this.switchToDefault();
            }).done();

            return true;
        } else if (this.trigger.schema === null) {
            // still in process of loading the schema, ignore...
            return true;
        } else {
            return this._continue(command);
        }
    }

    _continue(command) {
        if (DeviceChoiceDialog.chooseDevice(this, this.trigger))
            return true;

        if (this.query) {
            if (DeviceChoiceDialog.chooseDevice(this, this.query))
                return true;
        }

        if (this.action) {
            if (DeviceChoiceDialog.chooseDevice(this, this.action))
                return true;
        }

        if (SlotFillingDialog.slotFill(this, this.trigger, false, this.trigger.slots))
            return true;

        if (this.query) {
            if (SlotFillingDialog.slotFill(this, this.query, false, this.query.slots))
                return true;
        }

        if (this.action) {
            if (SlotFillingDialog.slotFill(this, this.action, true, this.action.slots))
                return true;
        }

        if (this.expecting === ValueCategory.YesNo) {
            if (command.isYes)
                return this.execute();
            else if (command.isNo)
                return this.reset();
            else
                return this.fail();
        } else {
            return this.ask(ValueCategory.YesNo, "Ok, so you want me to " +
                            this.describe() +
                            ". Is that right?");
        }
    }
}
