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

function completeDiscovery(dlg, device) {
    const delegate = {
        configDone() {
            // we're done here
            dlg.reply(dlg._("The device has been set up."));
        },

        // inform the user that discovery/configuration failed
        // for some reason
        configFailed(error) {
            dlg.reply(dlg._("Configuration failed: %s").format(error.message));
        },

        // ask the user a yes/no question
        // returns a promise with boolean value
        confirm(question) {
            return dlg.ask(ValueCategory.YesNo, question);
        },

        // ask the user for a PIN code/password
        // returns a promise of a string
        requestCode(question) {
            return dlg.ask(ValueCategory.RawString, question).then((v) => v.value);
        }
    }

    return device.completeDiscovery(delegate).catch((e) => {
        if (e.code === 'ECANCELLED')
            throw e;
        console.error('Failed to complete device configuration from discovery: ' + e.message);
    });
}

const DISCOVERY_TIMEOUT = 20000;

module.exports = function* discoveryDialog(dlg, discoveryName, discoveryType, discoveryKind) {
    // discovery will be null for cloud (Almond through Omlet)
    if (dlg.manager.discovery === null) {
        dlg.reply(dlg._("Discovery is not available in this installation of Almond."));
        return;
    }

    let devices;
    try {
        if (discoveryName !== undefined)
            dlg.reply(dlg._("Searching for %s…").format(discoveryName));
        else
            dlg.reply(dlg._("Searching for devices nearby…"));

        devices = yield dlg.manager.discovery.runDiscovery(DISCOVERY_TIMEOUT, discoveryType);
        if (devices === null)
            return;
    } catch(e) {
        dlg.manager.discovery.stopDiscovery().catch((e) => {
            console.error('Failed to stop discovery: ' + e.message);
        });
        if (e.code === 'ECANCELLED')
            throw e;
        dlg.reply(dlg._("Discovery failed: %s").format(e.message));
        return;
    }

    if (discoveryKind !== undefined)
        devices = devices.filter((d) => d.hasKind(discoveryKind));
    if (devices.length === 0) {
        if (discoveryName !== undefined)
            dlg.reply(dlg._("Can't find any %s around.").format(discoveryName));
        else
            dlg.reply(dlg._("Can't find any device around."));
        return;
    }

    if (devices.length === 1) {
        let device = devices[0];
        let answer = yield dlg.ask(ValueCategory.YesNo, dlg._("I found a %s. Do you want to set it up now?").format(device.name));
        if (answer) {
            dlg.manager.stats.hit('sabrina-confirm');
            return yield completeDiscovery(dlg, device);
        } else {
            return dlg.reset();
        }
    } else {
        let idx = yield dlg.askChoices(dlg._("I found the following devices. Which one do you want to set up?"),
            devices.map((d) => d.name));
        dlg.manager.stats.hit('sabrina-confirm');
        let device = devices[idx];
        return yield completeDiscovery(dlg, device);
    }
}
