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

module.exports = class CompleteDiscoveryDialog extends Dialog {
    constructor(device) {
        super();

        this.device = device;

        this._delegateCallback = null;
        this._delegateErrback = null;
    }

    start() {
        this.device.completeDiscovery(this).catch((e) => {
            console.error('Failed to complete device configuration from discovery: ' + e.message);
        }).finally(() => {
            this.switchToDefault();
        }).done();
    }

    stop() {
        if (this._delegateErrback)
            this._delegateErrback(new Error('User cancelled'));
    }

    // implementation of ConfigDelegate interface
    // (see thingpedia/lib/config_delegate.js)

    // report that the device was configured successfully
    configDone() {
        // we're done here
        this.reply(this._("The device has been set up."));
    }

    // inform the user that discovery/configuration failed
    // for some reason
    configFailed(error) {
        this.reply(this._("Configuration failed: %s").format(error.message));
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

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.expecting === ValueCategory.YesNo) {
                this._completePromise(!!command.isYes);
                return true;
            }

            return false;
        }).then(() => {
            this.switchToDefault();
            return true;
        });
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            this._completePromise(command);
            return true;
        } else {
            return super.handleRaw(command);
        }
    }
}
