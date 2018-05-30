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

function* runFormConfiguration(dlg, factory) {
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
        let v = yield dlg.ask(cat, dlg._("Please enter the %s.").format(field.label));
        state[field.name] = v.toJS();
    }

    yield dlg.manager.devices.loadOneDevice(state, true);

    // we're done here
    if (factory.category === 'online')
        dlg.reply(dlg._("The account has been set up."));
    else if (factory.category === 'physical')
        dlg.reply(dlg._("The device has been set up."));
    else
        dlg.reply(dlg._("The service has been set up."));
}

module.exports = function* configDialog(dlg, kind) {
    if (dlg.manager.isAnonymous) {
        dlg.reply(dlg._("This user is a demo only, and cannot configure new devices. To enable %s, you must register an account for yourself.")
            .format(Helpers.cleanKind(kind)));
        dlg.replyLink(dlg._("Register for Almond"), "/user/register");
        return;
    }

    let factories = yield dlg.manager.thingpedia.getDeviceSetup2([kind]);
    let factory = factories[kind];
    if (!factory) {
        dlg.reply(dlg._("I'm sorry, I can't find %s in my database.").format(Helpers.cleanKind(kind)));
    } else if (factory.type === 'none') {
        yield dlg.manager.devices.loadOneDevice({ kind: factory.kind }, true);
        dlg.reply(dlg._("%s has been enabled successfully.").format(factory.text));
    } else if (factory.type === 'multiple') {
        if (factory.choices.length > 0) {
            dlg.reply(dlg._("Choose one of the following to configure %s.").format(Helpers.cleanKind(kind)));
            for (let choice of factory.choices) {
                switch (choice.type) {
                case 'oauth2':
                    dlg.replyLink(dlg._("Configure %s").format(choice.text),
                                  '/devices/oauth2/%s?name=%s'.format(choice.kind, choice.text));
                    break;
                default:
                    dlg.replyButton(dlg._("Configure %s").format(choice.text), {
                        entities: {},
                        code: ['now', '=>', '@org.thingpedia.builtin.thingengine.builtin.configure', 'param:device:Entity(tt:device)', '=', 'device:' + choice.kind]
                    });
                }
            }
        } else {
            dlg.reply(dlg._("Sorry, I don't know how to configure %s.").format(kind));
        }
    } else if (factory.type === 'interactive') {
        const delegate = new DiscoveryDelegate(dlg, factory.category);

        yield dlg.manager.devices.factory.runInteractiveConfiguration(factory.kind, delegate);
    } else if (factory.type === 'discovery') {
        yield* discovery(dlg, factory.discoveryType, factory.kind, factory.text);
    } else if (factory.type === 'oauth2') {
        dlg.reply(dlg._("OK, here's the link to configure %s.").format(factory.text));
        dlg.replyLink(dlg._("Configure %s").format(factory.text),
                      '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
    } else if (factory.type === 'form') {
        yield* runFormConfiguration(dlg, factory);
    } else {
        dlg.reply(dlg._("I'm sorry, I don't know how to configure %s.").format(Helpers.cleanKind(kind)));
    }
};