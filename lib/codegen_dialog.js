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

const Dialog = require('./dialog');
const SlotFillingDialog = require('./slot_filling_dialog');
const DeviceChoiceDialog = require('./device_choice_dialog');
const ValueCategory = require('./semantic').ValueCategory;
const Codegen = require('./codegen');
const Helpers = require('./helpers');

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
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
        this.schema = null;
        this.args = null;
        this.slots = null;
        this.resolved_args = null;
        this.resolved_conditions = null;
        this.device = null;
    }

    execute() {
        this.manager.stats.hit('sabrina-confirm');
        return Q.try(() => {
            return this.codegen();
        }).then((code) => {
            var name = this.prefix() + ' ' + Codegen.capitalizeSelector(this.kind, this.channel);
            return this.manager.apps.loadOneApp(code, { $icon: this.icon }, undefined, undefined,
                                                name, this.describe(), true);
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

                return this.manager.schemas.getMeta(this.kind, this.CHANNEL_TYPE, this.channel).then((schema) => {
                    this.schema = schema;
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
