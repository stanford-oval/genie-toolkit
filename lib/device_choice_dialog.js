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
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');

module.exports = class DeviceChoiceDialog extends Dialog {
    constructor(kind) {
        super();

        this.kind = kind;
        this.device = null;
        this.resolving = null;
    }

    static chooseDevice(parent, obj, required) {
        if (obj.device === null) {
            // if we get here, either we never pushed the DeviceChoiceDialog,
            // or the DeviceChoiceDialog returned false from .handle(), which
            // implies it is done
            if (parent.subdialog === null) {
                parent.push(new DeviceChoiceDialog(obj.kind));
                if (parent.subdialog.continue())
                    return true;

                // fallthrough
            }

            obj.device = parent.subdialog.device;
            obj.id = obj.device.uniqueId;
            parent.pop();
            return false;
        } else {
            return false;
        }
    }

    continue() {
        var kind = this.kind;
        var devices = this.manager.devices.getAllDevicesOfKind(kind);

        if (devices.length === 0) {
            Helpers.promptConfigure(this, [kind]).then(() => {
                this.switchToDefault();
            }).done();
            return true;
        }

        if (devices.length === 1) {
            this.device = devices[0];
            return false;
        }

        if (devices.length > 0) {
            this.ask(ValueCategory.MultipleChoice, "You have multiple " + kind + "s. Which one do you want to use?");
            for (var i = 0; i < devices.length; i++)
                this.replyChoice(i, "device", devices[i].name);
            this.resolving = devices;
            return true;
        }

        return false;
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) ||
            value < 0 ||
            value >= this.resolving.length) {
            this.reply("Please click on one of the provided choices");
            return true;
        } else {
            this.device = this.resolving[value];
            this.resolving = [];
            this.expecting = null;
            return false;
        }
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        if (this.device === null &&
            this.expecting === ValueCategory.MultipleChoice) {
            if (this._handleResolve(command))
                return true;
        }

        return false;
    }
}
