// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

module.exports = function* initDialog(dlg, showWelcome) {
    var prefs = dlg.manager.platform.getSharedPreferences();
    var initialized = prefs.get('sabrina-initialized');
    if (initialized) {
        if (showWelcome) {
            dlg.reply(dlg._("Welcome back!"));
            dlg.reply(dlg._("If you need help at any point, try ‘help’."));
        }
    } else {
        prefs.set('sabrina-initialized', true);
        dlg.reply(dlg._("Hello! I'm Almond, your virtual assistant."));

        dlg.reply(dlg._("If you need help at any point, try ‘help’."));
        dlg.reply(dlg._("You'll want to start by setting up your devices and accounts though."));
        dlg.reply(dlg._("To do so, try ‘configure‘ followed by the type of device or account (e.g., ‘configure twitter’ or ‘configure tv’), or try ‘discover’ and I'll take a look at what you have."));
    }
}
