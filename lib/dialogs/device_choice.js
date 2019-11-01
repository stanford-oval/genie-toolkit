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

const Helpers = require('../helpers');
const DiscoveryDelegate = require('./discovery_delegate');

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
                await dlg.reply(dlg._("Sorry, to use %s, you must log in to your personal account.")
                    .format(Helpers.cleanKind(kind)));
                await dlg.replyLink(dlg._("Register for Almond"), "/user/register");
                return null;
            }
            if (!dlg.manager.user.canConfigureDevice(kind)) {
                await dlg.reply(dlg._("%s is not configured. You must ask the administrator of this Almond to enable it before using it.").format(factory.text || Helpers.cleanKind(kind)));
                return null;
            }

            if (factory.type === 'interactive') {
                const delegate = new DiscoveryDelegate(dlg, factory.category);

                return dlg.manager.devices.addInteractively(factory.kind, delegate);
            } else {
                if (factory.type === 'multiple' && factory.choices.length === 0 && kind.startsWith('org.thingpedia.builtin.')) {
                    dlg.fail();
                    return null;
                }

                await dlg.reply(dlg._("You don't have a %s.").format(factory.text || Helpers.cleanKind(kind)));
                if (factory.type === 'multiple' && factory.choices.length === 0)
                    return null;

                switch (factory.type) {
                case 'oauth2':
                    await dlg.replyLink(dlg._("Configure %s").format(factory.text),
                                  '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
                    break;
                default:
                    await dlg.replyButton(dlg._("Configure %s").format(factory.text || Helpers.cleanKind(kind)), {
                        entities: {},
                        code: ['now', '=>', '@org.thingpedia.builtin.thingengine.builtin.configure', 'param:device:Entity(tt:device)', '=', 'device:' + kind]
                    });
                }
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

    let devices = dlg.manager.devices.getAllDevicesOfKind(kind);

    if (devices.length === 0) {
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

    const name = getAttribute(selector.attributes, 'name');
    if (name !== undefined)
        devices = devices.filter((d) => like(d.name, name));

    if (devices.length === 1) {
        selector.device = devices[0];
        selector.id = selector.device.uniqueId;
        return true;
    }

    let question;
    if (name)
        question = dlg._("You have multiple “%s” %s devices. Which one do you want to use?").format(name, Helpers.cleanKind(kind));
    else
        question = dlg._("You have multiple %s devices. Which one do you want to use?").format(Helpers.cleanKind(kind));

    let choice = await dlg.askChoices(question, devices.map((d) => d.name));
    selector.device = devices[choice];
    selector.id = selector.device.uniqueId;
    return true;
}

module.exports = {
    chooseDevice,
    promptConfigure
};
