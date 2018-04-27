// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

const ValueCategory = require('../semantic').ValueCategory;

module.exports = class DiscoveryDelegate extends Tp.ConfigDelegate {
    constructor(dlg, deviceClass) {
        super();
        this._dlg = dlg;
        this._deviceClass = deviceClass;
    }

    configDone() {
        // we're done here
        if (this._deviceClass === 'online')
            this._dlg.reply(this._dlg._("The account has been set up."));
        else if (this._deviceClass === 'physical')
            this._dlg.reply(this._dlg._("The device has been set up."));
        else
            this._dlg.reply(this._dlg._("The service has been set up."));
    }

    // inform the user that discovery/configuration failed
    // for some reason
    configFailed(error) {
        this._dlg.reply(this._dlg._("Configuration failed: %s").format(error.message));
    }

    // send a message to the user (no other effect)
    reply(msg) {
        this._dlg.reply(msg);
    }

    // ask the user a yes/no question
    // returns a promise with boolean value
    confirm(question) {
        return this._dlg.ask(ValueCategory.YesNo, question);
    }

    // ask the user for a PIN code/password
    // returns a promise of a string
    requestCode(question) {
        return this._dlg.ask(ValueCategory.RawString, question).then((v) => v.value);
    }
};