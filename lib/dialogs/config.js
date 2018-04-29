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

module.exports = function* configDialog(dlg, kind) {
    if (dlg.manager.isAnonymous) {
        dlg.reply(dlg._("This user is a demo only, and cannot configure new devices. To enable %s, you must register an account for yourself.")
            .format(Helpers.cleanKind(kind)));
        dlg.replyLink(dlg._("Register for Almond"), "/user/register");
        return;
    }

    let factories = yield dlg.manager.thingpedia.getDeviceSetup([kind]);
    let factory = factories[kind];
    if (!factory) {
        dlg.reply(dlg._("I'm so sorry, I can't find %s in my database.").format(kind));
    } else if (factory.type === 'none') {
        yield dlg.manager.devices.loadOneDevice({ kind: factory.kind }, true);
        dlg.reply(dlg._("%s has been enabled successfully.").format(factory.text));
    } else if (factory.type === 'multiple') {
        if (factory.choices.length > 0) {
            dlg.reply(dlg._("You might want to configure one of: %s").format(factory.choices.join(', ')));
            dlg.replyLink(dlg._("Go to My Goods"), "/apps");
        } else {
            dlg.reply(dlg._("Sorry, I don't know how to configure %s.").format(kind));
        }
    } else if (factory.type === 'interactive') {
        const delegate = new DiscoveryDelegate(dlg, factory.category);

        yield dlg.manager.devices.factory.runInteractiveConfiguration(factory.kind, delegate);
    } else if (factory.type === 'discovery') {
        yield* discovery(dlg, factory.discoveryType, factory.kind, factory.text);
    } else {
        dlg.reply(dlg._("OK, here's the link to configure %s.").format(factory.text));
        switch (factory.type) {
            case 'oauth2':
                dlg.replyLink(dlg._("Configure %s").format(factory.text),
                              '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
                break;
            case 'link':
                dlg.replyLink(dlg._("Configure %s").format(factory.text, factory.href));
                break;
            case 'form':
                dlg.replyLink(dlg._("Configure %s").format(factory.text || dlg.kind),
                              '/devices/configure/%s?name=%s&controls=%s'.format(factory.kind, factory.text || dlg.kind,
                              JSON.stringify(factory.fields)));
        }
    }
};
