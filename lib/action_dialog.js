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

module.exports = class ActionDialog extends Dialog {
    constructor() {
        super();

        this.originalCommand = null;

        this.kind = null;
        this.channel = null;
        this.schema = null;
        this.args = null;
        this.resolved_args = null;
        this.resolved_conditions = null;
        this.device = null;
    }

    describe() {
        return this.schema.doc + " on " + this.device.name + " " +
            this.resolved_args.join(", ");
    }

    execute() {
        var kind = this.kind;
        var channel = this.channel;
        var args = this.resolved_args.map(ThingTalk.Ast.valueToJS);

        console.log('Executing action ' + channel + ' on ' + this.device.uniqueId);
        Q(this.device.invokeAction(channel, args)).then(function() {
            return this.done();
        }.bind(this)).catch(function(e) {
            this.reply("Sorry, that did not work: " + e.message);
            this.switchToDefault();
        }.bind(this)).done();

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

            this.manager.schemas.getMeta(this.kind, 'actions', this.channel).then((schema) => {
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

        if (SlotFillingDialog.slotFill(this, this, true))
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
