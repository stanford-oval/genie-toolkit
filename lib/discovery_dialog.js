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

const DISCOVERY_TIMEOUT = 60000;

// command to trigger:
// \r {"discover": {"name": "fitbit"}}
module.exports = class DiscoveryDialog extends Dialog {
    constructor() {
        super();
        this.name = null;
        this.candidateDevices = [];
        this.device = null;

        this._delegateCallback = null;
        this._delegateErrback = null;

        this._discovering = false;
    }

    stop() {
        if (this._delegateErrback)
            this._delegateErrback(new Error('User cancelled'));

        if (this._discovering) {
            this.manager.discovery.stopDiscovery().catch((e) => {
                console.error('Failed to stop discovery: ' + e.message);
            });
        }
    }

    // implementation of DiscoveryDelegate interface
    // (see thingpedia/lib/discovery_delegate.js)

    // offer the user a device as a choice from discovery
    deviceFound(device) {
        this.candidateDevices.push(device);
        this.replyChoice(this.candidateDevices.length-1, 'device',
                         device.name, device.description);
    }

    // report that the device was configured successfully
    deviceAdded(device) {
        // we're done here
        this.reply('The device has been set up.');
        this.switchToDefault();
    }

    // inform the user that discovery/configuration failed
    // for some reason
    discoveryFailed(error) {
        this.reply("Discovery failed: " + error.message);
        this.switchToDefault();
    }

    // ask the user to click an oauth link
    // returns undefined
    askOAuth(name, kind) {
        this.replyLink("Configure " + name, '/devices/oauth2/' + kind);
    }

    // ask the user a yes/no question
    // returns a promise with boolean value
    confirm(question) {
        this.ask(ValueCategory.YesNo, question);
        return Q.Promise((callback, errback) => {
            this._delegateCallback = callback;
            this._delegateErrback = errback;
        });
    }

    // ask the user for a PIN code/password
    // returns a promise of a string
    requestCode(question) {
        this.ask(ValueCategory.RawString, question);
        return Q.Promise((callback, errback) => {
            this._delegateCallback = callback;
            this._delegateErrback = errback;
        });
    }

    _completePromise(value) {
        this._delegateCallback(value);
        this._delegateCallback = null;
        this._delegateErrback = null;
    }

    discover() {
        if (!this.isSupported()) {
            this.reply("Sorry, we don't support the device for now.");
            this.switchToDefault();
            return false;
        }

        this._discovering = true;
        this.manager.discovery.runDiscovery(DISCOVERY_TIMEOUT, this).catch((e) => {
            console.error('Failed to stop discovery: ' + e.message);
        });
        return true;
    }

    // TODO: search database to check if we support the query device
    isSupported() {
        return true;
    }

    configure() {
        this.device.completeDiscovery(this);
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
            if (this._delegateCallback !== null) {
                this._completePromise(!!command.isYes);
            } else {
                if (command.isYes) {
                    this.configure();
                    this.switchToDefault();
                } else {
                    //this.reply('OK. Discovery canceled.');
                    this.reset();
                }
            }
            return true;
        }

        if (this.expecting === ValueCategory.MultipleChoice) {
            this._handleResolve(command);
            this.configure();
            this.switchToDefault();
            return true;
        }

        if (command.root.discover.name === undefined) {
            this.ask(ValueCategory.RawString, "What device do you want to discover?");
            return true;
        }
        this._continue();
        return true;
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            if (this._delegateCallback !== null) {
                this._completePromise(command);
            } else {
                this.name = command;
                this._continue();
            }
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
