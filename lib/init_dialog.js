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

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');

module.exports = class InitializationDialog extends Dialog {
    constructor() {
        super();
        this.name = null;
        this.tentative_name = null;
    }

    _checkName() {
        var prefs = this.manager.platform.getSharedPreferences();
        var name = prefs.get('sabrina-name');
        if (name !== undefined && name !== null) {
            this.name = name;
            return false;
        }

        this.tentative_name = this.manager.user.name;
        if (this.tentative_name)
            this.ask(ValueCategory.YesNo, this._("Can I call you %s?").format(this.tentative_name));
        else
            this.ask(ValueCategory.RawString, this._("What's your name?"));
        return true;
    }

    _handleNameResponse(word) {
        if (word.isYes) {
            this.name = this.tentative_name;
            var prefs = this.manager.platform.getSharedPreferences();
            prefs.set('sabrina-name', this.name);
            this.reply(this._("Hi %s, nice to meet you.").format(this.name));
            prefs.set('sabrina-initialized', true);
            this.expecting = null;
            return false;
        } else {
            return this.ask(ValueCategory.RawString, this._("Ok, what's your name then?"));
        }
    }

    start() {
        var prefs = this.manager.platform.getSharedPreferences();
        var initialized = prefs.get('sabrina-initialized');
        var name = prefs.get('sabrina-name');
        if (initialized) {
            this.reply(this._("Welcome back, %s!").format(name));
            return this.switchToDefault();
        }

        setTimeout(function() {
            this.reply(this._("Hello! My name is Sabrina, and I'm your virtual assistant."));

            this._continue();
        }.bind(this), 1000);
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            if (this.name === null) {
                this.name = command;
                var prefs = this.manager.platform.getSharedPreferences();
                prefs.set('sabrina-name', command);
                this.reply(this._("Hi %s, nice to meet you.").format(command));
                prefs.set('sabrina-initialized', true);
                return this._continue();
            }
        }

        return super.handleRaw(command);
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.expecting === ValueCategory.YesNo) {
                if (this.name === null) {
                    if (this._handleNameResponse(command))
                        return true;
                }
            }

            return this._continue();
        });
    }

    _continue() {
        if (this._checkName())
            return true;

        this.reply(this._("Ok, now I'm ready to use all my magic powers to help you."));
        this.reply(this._("If you don't know what to say, try ‘list commands’."));
        this.reply(this._("If you need help at any point, try ‘help’."));
        this.reply(this._("You'll want to start by setting up your devices and accounts though."));
        this.reply(this._("To do so, try ‘configure‘ followed by the type of device or account (e.g., ‘configure twitter’ or ‘configure tv’), or try ‘discover’ and I'll take a look at what you have."));
        this.switchToDefault();
        return true;
    }
}
