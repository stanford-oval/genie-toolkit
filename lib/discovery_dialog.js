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
const ConfigDialog = require('./config_dialog');

const DISCOVERY_TIMEOUT = 20000;

module.exports = class DiscoveryDialog extends Dialog {
    constructor() {
        super();
        this.name = null;
        this.candidateDevices = null;
        this.device = null;

        this._discovering = false;
    }

    stop() {
        if (this._discovering) {
            this.manager.discovery.stopDiscovery().catch((e) => {
                console.error('Failed to stop discovery: ' + e.message);
            });
        }
    }

    // TODO: search database to check if we support the query device
    // for now, this is already done by sempre, but it might be a little confusing
    // for users (they got 'can you rephrase it' rather than 'we don't support it')
    isSupported() {
        return true;
    }

    needDiscovery() {
        if (this.name === 'generic')
            return Q(true);

        return this.manager.thingpedia.getDeviceSetup([this.name]).then((setup) => {
            var setupType = setup[this.name].type;
            return !(setupType === 'link' || setupType === 'oauth2');
        });
    }

    discover() {
        if (!this.isSupported()) {
            this.reply(this._("Sorry, we don't support %s for now.").format(this.name));
            return Q(null);
        }

        this._discovering = true;
        this.reply(this._("Discovering…"));
        return this.manager.discovery.runDiscovery(DISCOVERY_TIMEOUT);
    }

    configure() {
        this.manager.stats.hit('sabrina-confirm');
        this.switchTo(new ConfigDialog(this.device));
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
        // discovery will be null for cloud (Sabrina through Omlet)
        if (this.manager.discovery === null) {
            this.reply(this._("Discovery is not available in this installation of Sabrina."));
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

        if (command.name === undefined) {
            this.ask(ValueCategory.RawString, this._("What device do you want to discover?"));
            return true;
        } else {
            this.name = command.name;
        }

        // if we get here, this.name has been setup
        return this.needDiscovery().then((need) => {
            if (need) {
                return this._continue();
            } else {
                this.reply(this._("I cannot discover devices of type %s. You might want to try 'configure %s' instead.").format(this.name, this.name));
                return this.switchToDefault();
            }
        });
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            this.name = command;
            this._continue();
            return true;
        } else if (this.resolving !== null &&
            this.expecting === ValueCategory.MultipleChoice) {
            for (var d of this.candidateDevices) {
                if (d.name.toLowerCase().trim() === raw.toLowerCase().trim()) {
                    this.device = d;
                    this.candidateDevices = [];
                    this.expecting = null;
                    this.configure();
                    return true;
                }
            }
            return this.unexpected();
        } else {
            return super.handleRaw(raw);
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
            this.expecting = null;
            return false;
        }
    }

    _continue() {
        if (this.candidateDevices === null) {
            this.discover().finally(() => {
                this._discovering = false;
            }).then((devices) => {
                if (devices === null) {
                    this.switchToDefault();
                    return false;
                }
                this.candidateDevices = devices;
                this._continue();
            }).catch((e) => {
                console.log(e);
                this.reply(this._("Discovery failed: %s").format(e.message));
                this.switchToDefault();
            }).done();
            return true;
        }

        var devices = this.candidateDevices;
        if (devices.length === 0) {
            this.reply(this._("Can't find %s device around.").format(this.name));
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
