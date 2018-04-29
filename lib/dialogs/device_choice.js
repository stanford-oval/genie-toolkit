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

const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const contactSearch = require('./contact_search');

const ValueCategory = require('../semantic').ValueCategory;
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

            if (factory.type === 'multiple') {
                dlg.reply(dlg._("You don't have a %s").format(Helpers.cleanKind(kind)));
                if (factory.choices.length > 0) {
                    dlg.reply(dlg._("You might want to configure one of: %s").format(factory.choices.join(', ')));
                    dlg.replyLink(dlg._("Go to Dashboard"), "/apps");
                }
            } else if (factory.type === 'interactive') {
                const delegate = new DiscoveryDelegate(dlg, factory.category);

                return dlg.manager.devices.factory.runInteractiveConfiguration(factory.kind, delegate);
            } else {
                dlg.reply(dlg._("You don't have a %s").format(factory.text));
                switch (factory.type) {
                case 'oauth2':
                    dlg.replyLink(dlg._("Configure %s").format(factory.text),
                                    '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
                    break;
                case 'link':
                    dlg.replyLink(dlg._("Configure %s").format(factory.text), factory.href);
                    break;
                case 'form':
                    dlg.replyLink(dlg._("Configure %s").format(factory.text || kind),
                                  '/devices/configure/%s?name=%s&controls=%s'.format(factory.kind, factory.text || kind,
                                  JSON.stringify(factory.fields)));
                }
            }

            return null;
        }
    });
}

function* chooseDevice(dlg, selector) {
    if (selector.isBuiltin) return true;
    if (selector.id !== null)
        return true;

    let kind = selector.kind;
    if (kind.startsWith('__dyn'))
        kind = 'org.thingpedia.builtin.thingengine.remote';
    let owner = selector.principal;

    if (owner === null) {
        let devices = dlg.manager.devices.getAllDevicesOfKind(kind);

        if (devices.length === 0) {
            dlg.debug('No device of kind ' + kind + ' available, attempting configure...');
            selector.device = yield promptConfigure(dlg, kind);
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

        let choice = yield dlg.askChoices(dlg._("You have multiple %s devices. Which one do you want to use?").format(Helpers.cleanKind(kind)),
            devices.map((d) => d.name));
        selector.device = devices[choice];
        selector.id = selector.device.uniqueId;
        return true;
    } else {
        if (owner.isUndefined) {
            let name = yield dlg.ask(ValueCategory.RawString, dlg._("Whose device do you want to access?"));
            selector.principal = yield* contactSearch(dlg, Type.Entity('tt:contact'), name.value);
            return selector.principal !== null;
        }
        if (owner.type === 'tt:contact')
            return true;
        selector.principal = yield* contactSearch(dlg, Type.Entity('tt:contact'), owner.value);
        return selector.principal !== null;

        /*if (owner.isArray) {
            let newprincipal = [];
            for (let elem of owner.value) {
                if (elem.type === 'tt:contact') {
                    newprincipal.push(elem);
                } else {
                    let resolved = yield* contactSearch(dlg, Type.Entity('tt:contact'), elem.value);
                    if (resolved === null)
                        return false;
                    newprincipal.push(resolved);
                }
            }
            owner = Ast.Value.Array(newprincipal);
            return true;
        } else {
            if (owner.type === 'tt:contact' || owner.type === 'tt:contact_group')
                return true;

            selector.principal = yield* contactSearch(dlg, Type.Entity('tt:contact'), owner.value);
            return selector.principal !== null;
        }*/
    }
}

module.exports = {
    chooseDevice,
    promptConfigure
};
