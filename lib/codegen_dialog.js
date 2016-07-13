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

const Dialog = require('./dialog');
const SlotFillingDialog = require('./slot_filling_dialog');
const DeviceChoiceDialog = require('./device_choice_dialog');
const ValueCategory = require('./semantic').ValueCategory;

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

    capitalizeSelector(kind, channel) {
        if (kind === '$builtin')
            return capitalize(channel);
        else
            return capitalize(kind);
    }

    execute() {
        return Q.try(() => {
            return this.codegen();
        }).then((code) => {
            var name = this.prefix() + ' ' + this.capitalizeSelector(this.kind, this.channel);
            return this.manager.apps.loadOneApp(code, {}, undefined, undefined,
                                                name, this.describe(), true);
        }).then(() => {
            if (this.autoConfirm)
                return this.switchToDefault();
            else
                return this.done();
        }).catch((e) => {
            this.reply("Sorry, that did not work: " + e.message);
            console.error(e.stack);
            return this.switchToDefault();
        });
    }

    handlePicture(url) {
        if (this.subdialog !== null) {
            if (this.subdialog.handlePicture(url))
                return true;

            return this._continue();
        } else {
            return super.handlePicture(url);
        }
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

        if (this.args === null)
            this.args = command.args;
        if (this.slots === null)
            this.slots = command.slots;

        if (this.kind === null) {
            this.kind = command.kind;
            this.channel = command.channel;

            return this.manager.schemas.getMeta(this.kind, this.CHANNEL_TYPE, this.channel).then((schema) => {
                this.schema = schema;
                return this._continue();
            }).catch((e) => {
                this.fail(e.message);
		console.error(e.stack);
                return this.switchToDefault();
            });
        } else if (this.schema === null) {
            // still in process of loading the schema, ignore...
            return true;
        } else {
            return this._continue(command);
        }
    }

    _continue(command) {
        return DeviceChoiceDialog.chooseDevice(this, this).then((waiting) => {
            if (waiting)
                return true;

            if (SlotFillingDialog.slotFill(this, this, this.slotFillAll, this.slots))
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
                    return this.ask(ValueCategory.YesNo, "Ok, so you want me to " +
                                    this.describe() +
                                    ". Is that right?");
                }
            }
        });
    }
}
