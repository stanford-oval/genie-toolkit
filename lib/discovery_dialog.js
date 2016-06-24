// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Silei Xu <silei@stanford.edu>
//
// See COPYING for details
"use strict"

const Q = require('q');
const events = require('events');

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');

// command to trigger:
// \r {"discover": {"arg": "name"}}
module.exports = class DiscoveryDialog extends Dialog {
    constructor() {
        super();
        this.arg = null;
        this.candidateDevices = null;
        this.device = null;
    }

    discover() {
        if (this.isName(this.arg)) {
            this.discoverByName();
            return true;
        } else if (this.isType(this.arg)) {
            this.discoverByType();
            return true;
        } else {
            this.reply("Can't find devices in database.");
            return false;
        }
    }

    // TODO: add real isName & isType functions
    isName(command) {
        return true;
    }

    isType(command) {
        return false;
    }

    // TODO: add real discover functions
    discoverByName() {
        this.candidateDevices = ["device1"];
    }

    discoverByType() {
        this.candidateDevices = ["device1", "device2"];
    }

    // TODO: transfer to config page
    configure() {
        this.reply('The device has been set up.');
    }

    handle(command) {
        if (this.expecting === ValueCategory.YesNo) {
            if (command.isYes) {
                this.configure();
            } else {
                this.reply('OK. Discovery canceled.');
            }
            this.switchToDefault();
            return true;
        }

        if (this.expecting === ValueCategory.MultipleChoice) {
            this._handleResolve(command);
            this.configure();
            this.switchToDefault();
            return true;
        }

        if (command.root.discover.arg === undefined) {
            this.ask(ValueCategory.RawString, "What device do you want to discover?");
            return true;
        }
        this._continue();
        return true;
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            this.arg = command;
            this._continue();
            return true;
        }
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) ||
            value < 0 ||
            value >= this.candidateDevices.length) {
            this.reply("Please click on one of the provided choices");
            return true;
        } else {
            this.device = this.candidateDevices[value];
            this.expecting = null;
            this.configure();
            return false;
        }
    }

    _continue() {
        if (!this.discover())
            return false;

        var devices = this.candidateDevices;
        if (devices.length === 0) {
            this.reply("Can't find devices around.");
            this.switchToDefault();
            return true;
        }
        if (devices.length === 1) {
            this.device = devices[0];
            this.ask(ValueCategory.YesNo, "Found device. Do you want to set it up now?");
            return true;
        }
        if (devices.length > 1) {
            this.ask(ValueCategory.MultipleChoice, "Found the following devices. Which one do you want to set up?");
            for (var i = 0; i < devices.length; i++)
                this.replyChoice(i, "device", devices[i]);
            return true;

        }
    }
}
