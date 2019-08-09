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

const ValueCategory = require('../semantic').ValueCategory;
const DiscoveryDelegate = require('./discovery_delegate');

async function completeDiscovery(dlg, device, deviceClass = 'physical') {
    const delegate = new DiscoveryDelegate(dlg, deviceClass);

    try {
        await dlg.manager.devices.completeDiscovery(device, delegate);
    } catch (e) {
        if (e.code === 'ECANCELLED')
            throw e;
        console.error('Failed to complete device configuration from discovery: ' + e.message);
    }
}

const DISCOVERY_TIMEOUT = 20000;

module.exports = async function discoveryDialog(dlg, discoveryType, discoveryKind, discoveryName) {
    // discovery will be null for cloud (Almond through Omlet)
    if (dlg.manager.discovery === null) {
        dlg.reply(dlg._("Discovery is not available in this installation of Almond."));
        return;
    }
    if (dlg.manager.isAnonymous) {
        dlg.reply(dlg._("Sorry, to discover new devices you must log in to your personal account."));
        dlg.replyLink(dlg._("Register for Almond"), "/user/register");
        return;
    }
    if (!dlg.manager.user.canConfigureDevice(null)) {
        dlg.forbid();
        return;
    }

    let devices;
    try {
        if (discoveryName !== undefined)
            dlg.reply(dlg._("Searching for %s…").format(discoveryName));
        else
            dlg.reply(dlg._("Searching for devices nearby…"));

        devices = await dlg.manager.discovery.runDiscovery(DISCOVERY_TIMEOUT, discoveryType);
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
        let answer = await dlg.ask(ValueCategory.YesNo, dlg._("I found a %s. Do you want to set it up now?").format(device.name));
        if (answer) {
            dlg.manager.stats.hit('sabrina-confirm');
            await completeDiscovery(dlg, device);
        } else {
            dlg.reset();
        }
    } else {
        let idx = await dlg.askChoices(dlg._("I found the following devices. Which one do you want to set up?"),
            devices.map((d) => d.name));
        dlg.manager.stats.hit('sabrina-confirm');
        let device = devices[idx];
        await completeDiscovery(dlg, device);
    }
};
