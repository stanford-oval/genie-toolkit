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

module.exports = class ConfigDialog extends Dialog {
    constructor(device) {
        super();

        this.device = device;
        this.kind = null;

        this._delegateCallback = null;
        this._delegateErrback = null;
    }

    start() {
        if (this.device) {
            this.device.completeDiscovery(this).catch((e) => {
                console.error('Failed to complete device configuration from discovery: ' + e.message);
            }).finally(() => {
                this.switchToDefault();
            }).done();
        }
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

    // ask the user to click an oauth link
    // returns undefined
    askOAuth(name, kind) {
        this.replyLink(this._("Configure %s").format(name), '/devices/oauth2/' + kind);
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

    _promptConfigure() {
        return this.manager.thingpedia.getDeviceSetup([this.kind]).then((factories) => {
            var factory = factories[this.kind];
            if (!factory) {
                this.reply(this._("I'm so sorry, I can't find %s in my database.").format(this.kind));
                return false;
            }

            if (factory.type === 'none') {
                this.reply(this._("%s doesn't need configuration.").format(this.kind));
                return false;
            } else if (factory.type === 'multiple') {
                if (factory.choices.length > 0) {
                    this.reply(this._("You might want to configure one of: %s").format(factory.choices.join(', ')));
                    this.replyLink(this._("Go to Dashboard"), "/apps");
                } else {
                    this.reply(this._("Sorry, I don't know how to configure %s.").format(this.kind));
                }
            } else {
                this.reply(this._("OK, here's the link to configure %s.").format(this.kind));
                switch (factory.type) {
                    case 'oauth2':
                        this.replyLink(this._("Configure %s").format(factory.text), '/devices/oauth2/' + factory.kind);
                        break;
                    case 'link':
                        this.replyLink(this._("Configure %s").format(factory.text, factory.href));
                        break;
                }
            }
            return true;
        });
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.expecting === ValueCategory.YesNo) {
                this._completePromise(!!command.isYes);
                return true;
            }

            this.kind = command.name;
            if (this.kind === 'generic') {
                this.reply(this._("You can configure devices by command ‘configure ____’, e.g., ‘configure twitter’."));
                this.switchToDefault();
                return true;
            }

            return this._promptConfigure();
        }).then(() => {
            this.switchToDefault();
            return true;
        });
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            this._completePromise(command);
            return true;
        }
    }
}
