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
        let v = await dlg.ask(cat, dlg._("Please enter the ${label}."), { label: field.label });
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
        await dlg.replyInterp(dlg._("Sorry, to enable ${device}, you must log in to your personal account."), {
            device: Helpers.cleanKind(kind)
        });
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
        await dlg.replyInterp(dlg._("I'm sorry, I can't find ${device} in my database."), {
            device: Helpers.cleanKind(kind)
        });
    } else if (factory.type === 'none') {
        await dlg.manager.devices.addSerialized({ kind: factory.kind });
        await dlg.replyInterp(dlg._("${device} has been enabled successfully."), {
            device: factory.text
        });
    } else if (factory.type === 'multiple') {
        if (dlg.manager.platform.type === 'server')
            factory.choices = factory.choices.filter((f) => f.type !== 'oauth2');

        if (factory.choices.length > 0) {
            await dlg.replyInterp(dlg._("Choose one of the following to configure ${device}."), {
                device: Helpers.cleanKind(kind)
            });
            for (let choice of factory.choices) {
                switch (choice.type) {
                case 'oauth2':
                    await dlg.replyLink(dlg.interpolate(dlg._("Configure ${device}"), { device: choice.text }),
                        dlg.interpolate('/devices/oauth2/${device:url}?name=${name:url}', {
                            device: choice.kind,
                            name: choice.text
                        }));
                    break;
                default:
                    await dlg.replyButton(dlg.interpolate(dlg._("Configure ${device}"), { device: choice.text }), {
                        entities: {},
                        code: ['now', '=>', '@org.thingpedia.builtin.thingengine.builtin.configure', 'param:device:Entity(tt:device)', '=', 'device:' + choice.kind]
                    });
                }
            }
        } else {
            await dlg.replyInterp(dlg._("Sorry, I don't know how to configure ${device}."), {
                device: Helpers.cleanKind(kind)
            });
        }
    } else if (factory.type === 'interactive') {
        const delegate = new DiscoveryDelegate(dlg, factory.category);

        await dlg.manager.devices.addInteractively(factory.kind, delegate);
    } else if (factory.type === 'discovery') {
        await discovery(dlg, factory.discoveryType, factory.kind, factory.text);
    } else if (factory.type === 'oauth2') {
        if (dlg.manager.platform.type === 'server') {
            await dlg.replyInterp(dlg._("I'm sorry, but ${device} is not supported on this version of Almond."), {
                device: factory.text
            });
            return;
        }

        await dlg.replyInterp(dlg._("OK, here's the link to configure ${device}."), {
            device: factory.text
        });
        await dlg.replyLink(dlg.interpolate(dlg._("Configure ${device}"), { device: factory.text }),
            dlg.interpolate('/devices/oauth2/${device:url}?name=${name:url}', {
                device: factory.kind,
                name: factory.text
            }));
    } else if (factory.type === 'form') {
        await runFormConfiguration(dlg, factory);
    } else {
        await dlg.replyInterp(dlg._("I'm sorry, I don't know how to configure ${device}."), {
            device: Helpers.cleanKind(kind)
        });
    }
};
