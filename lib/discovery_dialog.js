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

const DISCOVERY_TIMEOUT = 60000;

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
    isSupported() {
        return true;
    }

    needDiscovery() {
        if (this.name === 'generic')
            return Q(true);

        return this.manager.thingpedia.getDeviceSetup([this.name]).then((setup) => {
            return !(setup.type === 'link' || setup.type === 'oauth2');
        });
    }

    // TODO: set this.device by this.name
    // not sure if this is the right way
    setDevice() {
        this.device = this.name;
    }

    discover() {
        if (!this.isSupported()) {
            this.reply("Sorry, we don't support " + this.name + " for now.");
            return Q(null);
        }

        this._discovering = true;
        this.reply("Discovering...");
        return this.manager.discovery.runDiscovery(DISCOVERY_TIMEOUT);
    }

    configure() {
        this.switchTo(new ConfigDialog(this.device));
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        // discovery will be null for cloud (Sabrina through Omlet)
        if (this.manager.discovery === null) {
            this.reply("Discovery is not available in this installation of Sabrina");
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
            this.ask(ValueCategory.RawString, "What device do you want to discover?");
            return true;
        } else {
            this.name = command.name;
        }

        // if we get here, this.name has been setup
        this.needDiscovery().then((need) => {
            if (need) {
                this._continue();
            } else {
                this.setDevice();
                this.configure();
            }
        }).done();
        return true;
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            this.name = command;
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
                this.reply("Discovery failed: " + e.message);
                this.switchToDefault();
            }).done();
            return true;
        }

        var devices = this.candidateDevices;
        if (devices.length === 0) {
            this.reply("Can't find " + this.name + " device around.");
            this.switchToDefault();
            return false;
        }
        if (devices.length === 1) {
            this.device = devices[0];
            this.ask(ValueCategory.YesNo, "Found a " + this.device.name + ". Do you want to set it up now?");
            return true;
        }
        if (devices.length > 1) {
            this.ask(ValueCategory.MultipleChoice, "Found the following devices. Which one do you want to set up?");
            for (var i = 0; i < devices.length; i++)
                this.replyChoice(i, "device", devices[i].name);
            return true;

        }
    }
}
