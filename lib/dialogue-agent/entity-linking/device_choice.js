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

const assert = require('assert');
const Helpers = require('../helpers');

function promptConfigure(dlg, kind) {
    return dlg.manager.thingpedia.getDeviceSetup([kind]).then(async (factories) => {
        var factory = factories[kind];
        if (!factory) {
            // something funky happened or thingpedia did not recognize the kind
            dlg.fail();
            return null;
        }

        if (factory.type === 'none') {
            return dlg.manager.devices.addSerialized({ kind: factory.kind });
        } else {
            if (dlg.manager.isAnonymous) {
                await dlg.reply(dlg._("Sorry, I did not understand that. You might need to enable a new skill before I understand that command. To do so, please log in to your personal account."));
                await dlg.replyLink(dlg._("Register for Almond"), "/user/register");
            } else {
                await dlg.reply(dlg._("Sorry, I did not understand that. You might need to enable a new skill before I understand that command."));
                await dlg.replyLink(dlg._("Configure a new skill"), "/devices/create");
            }
            return null;
        }
    });
}

function getAttribute(attributes, name) {
    for (let attr of attributes) {
        if (attr.name === name)
            return attr.value.toJS();
    }
    return undefined;
}

function like(str, substr) {
    if (!str)
        return false;
    return str.toLowerCase().indexOf(substr.toLowerCase()) >= 0;
}

async function chooseDevice(dlg, selector) {
    if (selector.isBuiltin) return true;
    if (selector.id !== null)
        return true;

    let kind = selector.kind;
    if (kind.startsWith('__dyn'))
        kind = 'org.thingpedia.builtin.thingengine.remote';
    if (selector.principal !== null) {
        await dlg.reply(dlg._("Remote devices are not supported in this version of Almond."));
        return false;
    }

    const alldevices = dlg.manager.devices.getAllDevicesOfKind(kind);

    if (alldevices.length === 0) {
        dlg.debug('No device of kind ' + kind + ' available, attempting configure...');
        const device = await promptConfigure(dlg, kind);
        if (device === null)
            return false;

        if (selector.all)
            return true;
        selector.device = device;
        selector.id = device.uniqueId;
        return true;
    }

    if (selector.all)
        return true;

    let selecteddevices = alldevices;
    const name = getAttribute(selector.attributes, 'name');
    if (name !== undefined)
        selecteddevices = alldevices.filter((d) => like(d.name, name));

    if (selecteddevices.length === 1) {
        selector.device = selecteddevices[0];
        selector.id = selector.device.uniqueId;
        return true;
    }

    if (selecteddevices.length === 0) {
        assert(name);
        const question = dlg.interpolate(dlg._("I cannot find any “${name}” device. Which ${device} do you want to use?"), {
            name,
            device: Helpers.cleanKind(kind)
        });
        let choice = await dlg.askChoices(question, alldevices.map((d) => d.name));
        selector.device = alldevices[choice];
        selector.id = selector.device.uniqueId;
        selector.attributes = [];
        return true;
    } else {
        let question = dlg.interpolate(
            dlg._("You have multiple ${?“${name}” }${device} devices. Which one do you want to use?"), {
                name, device: Helpers.cleanKind(kind)
            });

        let choice = await dlg.askChoices(question, selecteddevices.map((d) => d.name));
        selector.device = selecteddevices[choice];
        selector.id = selector.device.uniqueId;
        return true;
    }
}

module.exports = {
    chooseDevice,
    promptConfigure
};
