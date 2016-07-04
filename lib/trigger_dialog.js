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
const Codegen = require('./codegen');

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

module.exports = class TriggerDialog extends Dialog {
    constructor() {
        super();

        this.originalCommand = null;

        this.kind = null;
        this.id = null;
        this.channel = null;
        this.schema = null;
        this.args = null;
        this.resolved_args = null;
        this.resolved_conditions = null;
        this.device = null;
    }

    describe() {
        return "Notify if " + Codegen.describeTrigger(this.kind,
            this.channel,
            this.schema,
            this.resolved_args);
    }

    capitalizeSelector(kind, channel) {
        if (kind === '$builtin')
            return capitalize(channel);
        else
            return capitalize(kind);
    }

    execute() {
        Q.try(() => {
            return Codegen.codegenMonitor(this.manager.schemas, this);
        }).then((code) => {
            var name = 'Monitor ' + this.capitalizeSelector(this.kind, this.channel);
            this.manager.apps.loadOneApp(code, {}, undefined, undefined,
                                         name, this.describe(), true);
        }).then(() => {
            this.switchToDefault();
        }).catch((e) => {
            this.reply("Sorry, that did not work: " + e.message);
            console.error(e.stack);
            this.switchToDefault();
        }).done();

        return true;
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

        if (this.kind === null) {
            this.kind = command.kind;
            this.channel = command.channel;

            this.manager.schemas.getMeta(this.kind, 'triggers', this.channel).then((schema) => {
                this.schema = schema;
                this._continue();
            }).catch((e) => {
                this.fail(e.message);
                this.switchToDefault();
            }).done();

            return true;
        } else if (this.schema === null) {
            // still in process of loading the schema, ignore...
            return true;
        } else {
            return this._continue(command);
        }
    }

    _continue(command) {
        if (DeviceChoiceDialog.chooseDevice(this, this))
            return true;

        if (SlotFillingDialog.slotFill(this, this, false))
            return true;

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
