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
    return dlg.manager.thingpedia.getDeviceSetup([kind]).then((factories) => {
        var factory = factories[kind];
        if (!factory) {
            // something funky happened or thingpedia did not recognize the kind
            dlg.reply(dlg._("You don't have a %s").format(Helpers.cleanKind(kind)));
            return null;
        }

        if (factory.type === 'none') {
            return dlg.manager.devices.loadOneDevice({ kind: factory.kind }, true);
        } else {
            if (dlg.manager.isAnonymous) {
                dlg.reply(dlg._("This user is a demo only, and cannot configure new devices. To enable %s, you must register an account for yourself.")
                    .format(Helpers.cleanKind(kind)));
                dlg.replyLink(dlg._("Register for Almond"), "/user/register");
                return null;
            }

            if (factory.type === 'interactive') {
                const delegate = new DiscoveryDelegate(dlg, factory.category);

                return dlg.manager.devices.factory.runInteractiveConfiguration(factory.kind, delegate);
            } else {
                dlg.reply(dlg._("You don't have a %s").format(factory.text || Helpers.cleanKind(kind)));
                if (factory.type === 'multiple' && factory.choices.length === 0)
                    return null;

                switch (factory.type) {
                case 'oauth2':
                    dlg.replyLink(dlg._("Configure %s").format(factory.text),
                                  '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
                    break;
                default:
                    dlg.replyButton(dlg._("Configure %s").format(factory.text || Helpers.cleanKind(kind)), {
                        entities: {},
                        code: ['now', '=>', '@org.thingpedia.builtin.thingengine.builtin.configure', 'param:device:Entity(tt:device)', '=', 'device:' + kind]
                    });
                }
            }

            return null;
        }
    });
}

async function chooseDevice(dlg, selector) {
    if (selector.isBuiltin) return true;
    if (selector.id !== null)
        return true;

    let kind = selector.kind;
    if (kind.startsWith('__dyn'))
        kind = 'org.thingpedia.builtin.thingengine.remote';
    if (selector.principal !== null) {
        dlg.reply(dlg._("Remote devices are not supported in this version of Almond."));
        return false;
    }

    let devices = dlg.manager.devices.getAllDevicesOfKind(kind);

    if (devices.length === 0) {
        dlg.debug('No device of kind ' + kind + ' available, attempting configure...');
        selector.device = await promptConfigure(dlg, kind);
        if (selector.device === null) {
            return false;
        } else {
            selector.id = selector.device.uniqueId;
            return true;
        }
    }

    if (devices.length === 1) {
        selector.device = devices[0];
        selector.id = selector.device.uniqueId;
        return true;
    }

    let choice = await dlg.askChoices(dlg._("You have multiple %s devices. Which one do you want to use?").format(Helpers.cleanKind(kind)),
        devices.map((d) => d.name));
    selector.device = devices[choice];
    selector.id = selector.device.uniqueId;
    return true;
}

module.exports = {
    chooseDevice,
    promptConfigure
};
