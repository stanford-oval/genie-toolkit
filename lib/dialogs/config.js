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

const discovery = require('./discovery');

const Helpers = require('../helpers');
const DiscoveryDelegate = require('./discovery_delegate');
const { ValueCategory } = require('../semantic');

async function runFormConfiguration(dlg, factory) {
    let state = {
        kind: factory.kind
    };
    for (let field of factory.fields) {
        let cat;
        switch (field.type) {
        case 'password':
            cat = ValueCategory.Password;
            break;
        case 'number':
            cat = ValueCategory.Number;
            break;
        default:
            cat = ValueCategory.RawString;
        }
        let v = await dlg.ask(cat, dlg._("Please enter the %s.").format(field.label));
        state[field.name] = v.toJS();
    }

    await dlg.manager.devices.addSerialized(state);

    // we're done here
    if (factory.category === 'online')
        await dlg.reply(dlg._("The account has been set up."));
    else if (factory.category === 'physical')
        await dlg.reply(dlg._("The device has been set up."));
    else
        await dlg.reply(dlg._("The service has been set up."));
}

module.exports = async function configDialog(dlg, kind) {
    if (dlg.manager.isAnonymous) {
        await dlg.reply(dlg._("Sorry, to enable %s, you must log in to your personal account.")
            .format(Helpers.cleanKind(kind)));
        await dlg.replyLink(dlg._("Register for Almond"), "/user/register");
        return;
    }
    if (!dlg.manager.user.canConfigureDevice(kind)) {
        dlg.forbid();
        return;
    }

    let factories = await dlg.manager.thingpedia.getDeviceSetup([kind]);
    let factory = factories[kind];
    if (!factory) {
        await dlg.reply(dlg._("I'm sorry, I can't find %s in my database.").format(Helpers.cleanKind(kind)));
    } else if (factory.type === 'none') {
        await dlg.manager.devices.addSerialized({ kind: factory.kind });
        await dlg.reply(dlg._("%s has been enabled successfully.").format(factory.text));
    } else if (factory.type === 'multiple') {
        if (dlg.manager.platform.type === 'server')
            factory.choices = factory.choices.filter((f) => f.type !== 'oauth2');

        if (factory.choices.length > 0) {
            await dlg.reply(dlg._("Choose one of the following to configure %s.").format(Helpers.cleanKind(kind)));
            for (let choice of factory.choices) {
                switch (choice.type) {
                case 'oauth2':
                    await dlg.replyLink(dlg._("Configure %s").format(choice.text),
                                  '/devices/oauth2/%s?name=%s'.format(choice.kind, choice.text));
                    break;
                default:
                    await dlg.replyButton(dlg._("Configure %s").format(choice.text), {
                        entities: {},
                        code: ['now', '=>', '@org.thingpedia.builtin.thingengine.builtin.configure', 'param:device:Entity(tt:device)', '=', 'device:' + choice.kind]
                    });
                }
            }
        } else {
            await dlg.reply(dlg._("Sorry, I don't know how to configure %s.").format(Helpers.cleanKind(kind)));
        }
    } else if (factory.type === 'interactive') {
        const delegate = new DiscoveryDelegate(dlg, factory.category);

        await dlg.manager.devices.addInteractively(factory.kind, delegate);
    } else if (factory.type === 'discovery') {
        await discovery(dlg, factory.discoveryType, factory.kind, factory.text);
    } else if (factory.type === 'oauth2') {
        if (dlg.manager.platform.type === 'server') {
            await dlg.reply(dlg._("I'm sorry, but %s is not supported on this version of Almond.").format(factory.text));
            return;
        }

        await dlg.reply(dlg._("OK, here's the link to configure %s.").format(factory.text));
        await dlg.replyLink(dlg._("Configure %s").format(factory.text),
                      '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
    } else if (factory.type === 'form') {
        await runFormConfiguration(dlg, factory);
    } else {
        await dlg.reply(dlg._("I'm sorry, I don't know how to configure %s.").format(Helpers.cleanKind(kind)));
    }
};
