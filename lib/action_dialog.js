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
const ValueCategory = require('./semantic').ValueCategory;

module.exports = class ActionDialog extends Dialog {
    constructor(directExec) {
        super();
        this.directExec = directExec;

        this.originalCommand = null;

        this.kind = null;
        this.channel = null;
        this.schema = null;
        this.device = null;
        this.resolving = null;
        this.args = null;
    }

    describe() {
        return this.schema.doc + " on " + this.device.name + " " +
            this.args.join(", ");
    }

    _askDevice() {
        var kind = this.kind;
        var devices = this.manager.devices.getAllDevicesOfKind(kind);

        if (devices.length === 0) {
            this.reply("You don't have a " + kind);
            this.switchToDefault();
            return true;
        }

        if (devices.length === 1) {
            this.device = [devices[0]];
            return false;
        }

        if (devices.length > 0) {
            this.ask(ValueCategory.MultipleChoice, "You have multiple " + kind + "s. Which one do you want to use?");
            for (var i = 0; i < devices.length; i++)
                this.replyChoice(i, "device", devices[i].name);
            this.resolving = devices;
            return true;
        }
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) ||
            value < 1 ||
            value > this.resolving.length) {
            this.reply("Please click on one of the provided choices");
            return true;
        } else {
            this.device = this.resolving[value-1];
        }

        this.resolving = [];
        this.expecting = null;
        return false;
    }

    execute() {
        var kind = this.kind;
        var channel = this.channel;
        var args = this.args;

        console.log('Executing action ' + channel + ' on ' + this.device.uniqueId);
        this.device.invokeAction(channel, args).then(function() {
            return this.done();
        }.bind(this)).catch(function(e) {
            this.reply("Sorry, that did not work: " + e.message);
            this.switchToDefault();
        }.bind(this)).done();

        return true;
    }

    handle(command) {
        if (this.originalCommand === null)
            this.originalCommand = command;

        if (this.kind === null) {
            this.kind = command.kind;
            this.channel = command.channel;

            this.manager.schemas.getMeta(this.kind).then((schema) => {
                if (schema === null) {
                    this.sendReply("I don't know what " + this.kind + " is.");
                    this.switchToDefault();
                } else {
                    if (!(this.channel in schema.actions)) {
                        this.sendReply("Things of kind " + this.kind + " cannot " + this.channel + ".");
                        this.switchToDefault();
                    } else {
                        this.schema = schema.actions[this.channel];
                        this._continue();
                    }
                }
            }).catch((e) => {
                console.error("Failed to retrieve schema for " + this.kind + ": " + e.message);
                this.failReset();
            }).done();
        } else if (this.schema === null) {
            // still in process of loading the schema, ignore...
            return;
        } else {
            this._continue(command);
        }
    }

    _continue(command) {
        if (this._askDevice())
            return true;

        if (this.device === null &&
            this.expecting === ValueCategory.MultipleChoice) {
            if (this._handleResolve(command))
                return true;
        }

        if (this.args === null) {
            // if we get here, either we never pushed the SlotFillingDialog,
            // or the SlotFillingDialog returned false from .handle(), which
            // implies it is done
            if (this.subdialog === null) {
                // make up slots
                var slots = this.schema.schema.map(function(typeString, i) {
                    var type = ThingTalk.Type.fromString(type);
                    return { name: this.schema.schema.args[i], type: type,
                             question: this.schema.schema.questions[i] };
                });

                this.push(new SlotFillingDialog(slots, this.originalCommand.args));
                if (this.subdialog.continue())
                    return;
            } else {
                this.args = this.subdialog.values;
                this.pop();
            }
        }

        if (!this.directExec)
            return false;

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
