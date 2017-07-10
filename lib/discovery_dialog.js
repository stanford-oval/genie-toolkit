// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Silei Xu <silei@stanford.edu>
//
// See COPYING for details
"use strict"

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const CompleteDiscoveryDialog = require('./complete_discovery_dialog');

const DISCOVERY_TIMEOUT = 20000;

module.exports = class DiscoveryDialog extends Dialog {
    constructor(discoveryType, discoveryKind, discoveryName) {
        super();
        this.candidateDevices = null;
        this.device = null;

        this.discoveryType = discoveryType || undefined;
        this.discoveryKind = discoveryKind || undefined;
        this.discoveryName = discoveryName || undefined;
        this.icon = this.discoveryKind;

        this._discovering = false;
    }

    stop() {
        if (this._discovering) {
            this.manager.discovery.stopDiscovery().catch((e) => {
                console.error('Failed to stop discovery: ' + e.message);
            });
        }
    }

    discover() {
        this._discovering = true;
        if (this.discoveryName !== undefined)
            this.reply(this._("Searching for %s…").format(this.discoveryName));
        else
            this.reply(this._("Searching for devices nearby…"));
        return this.manager.discovery.runDiscovery(DISCOVERY_TIMEOUT, this.discoveryType);
    }

    configure() {
        this.manager.stats.hit('sabrina-confirm');
        this.switchTo(new CompleteDiscoveryDialog(this.device));
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;
            else
                return this._continueHandle(command);
        });
    }

    _continueHandle(command) {
        // discovery will be null for cloud (Almond through Omlet)
        if (this.manager.discovery === null) {
            this.reply(this._("Discovery is not available in this installation of Almond."));
            this.switchToDefault();
            return true;
        }

        if (this.expecting === ValueCategory.YesNo) {
            if (command.isYes) {
                this.configure();
            } else {
                this.reset();
            }
            return true;
        }

        if (this.expecting === ValueCategory.MultipleChoice) {
            if (this._handleResolve(command))
                return true;
            this.configure();
            return true;
        }

        return this.continue();
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            this.name = command;
            this._continue();
            return true;
        } else {
            return super.handleRaw(command);
        }
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) ||
            value < 0 ||
            value >= this.candidateDevices.length) {
            this.reply(this._("Please click on one of the provided choices."));
            return true;
        } else {
            this.device = this.candidateDevices[value];
            return false;
        }
    }

    continue() {
        if (this.candidateDevices === null) {
            this.discover().finally(() => {
                this._discovering = false;
            }).then((devices) => {
                if (devices === null) {
                    this.switchToDefault();
                    return false;
                }

                if (this.discoveryKind !== undefined)
                    devices = devices.filter((d) => d.hasKind(this.discoveryKind));
                this.candidateDevices = devices;
                this.continue();
            }).catch((e) => {
                console.log(e);
                this.reply(this._("Discovery failed: %s").format(e.message));
                this.switchToDefault();
            }).done();
            return true;
        }

        var devices = this.candidateDevices;
        if (devices.length === 0) {
            if (this.discoveryName !== undefined)
                this.reply(this._("Can't find any %s around.").format(this.discoveryName));
            else
                this.reply(this._("Can't find any device around."));
            this.switchToDefault();
            return false;
        }
        if (devices.length === 1) {
            this.device = devices[0];
            this.ask(ValueCategory.YesNo, this._("I found a %s. Do you want to set it up now?").format(this.device.name));
            return true;
        }
        if (devices.length > 1) {
            this.ask(ValueCategory.MultipleChoice, this._("I found the following devices. Which one do you want to set up?"));
            for (var i = 0; i < devices.length; i++)
                this.replyChoice(i, "device", devices[i].name);
            return true;

        }
    }
}
