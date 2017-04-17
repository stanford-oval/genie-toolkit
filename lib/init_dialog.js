// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
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
    start() {
        var prefs = this.manager.platform.getSharedPreferences();
        var initialized = prefs.get('sabrina-initialized');
        if (initialized) {
            //this.reply(this._("Welcome back!"));
            //this.reply(this._("If you need help at any point, try ‘help’."));
            return this.switchToDefault();
        } else {
            prefs.set('sabrina-initialized', true);
            this.reply(this._("Hello! I'm Almond, your virtual assistant."));

            this.reply(this._("If you need help at any point, try ‘help’."));
            this.reply(this._("You'll want to start by setting up your devices and accounts though."));
            this.reply(this._("To do so, try ‘configure‘ followed by the type of device or account (e.g., ‘configure twitter’ or ‘configure tv’), or try ‘discover’ and I'll take a look at what you have."));
            this.switchToDefault();
        }
    }
}
