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

function configureMessaging(dlg) {
    return dlg.manager.devices.factory.getFactory('org.thingpedia.builtin.matrix').then((factory) => {
        const delegate = {
            reply(msg) {
                return dlg.reply(msg);
            },
            confirm(question) {
                return dlg.ask(ValueCategory.YesNo, question);
            },
            requestCode(question) {
                return dlg.ask(ValueCategory.RawString, question).then((v) => v.value);
            }
        };

        // FIXME _engine access
        return factory.configureFromAlmond(dlg.manager._engine, delegate);
    }).catch((e) => {
        if (e.code === 'ECANCELLED')
            throw e;
        console.error(e.stack);
        dlg.reply(dlg._("Sorry, that did not work: %s").format(e.message));
        dlg.reply(dlg._("You should try again later."));
    });
}

module.exports = function* initDialog(dlg, showWelcome) {
    var prefs = dlg.manager.platform.getSharedPreferences();
    var initialized = prefs.get('sabrina-initialized');
    if (dlg.manager.messaging.isAvailable) {
        // assume that Almond was initialized in some other way
        prefs.set('sabrina-initialized', true);
        initialized = true;
    }

    if (initialized) {
        if (!dlg.manager.messaging.isAvailable) {
            dlg.reply(dlg._("Welcome back!"));
            dlg.reply(dlg._("You haven't configured a Matrix account yet. You need a Matrix account to let me talk to other Almonds."));
            yield configureMessaging(dlg);
        } else if (showWelcome) {
            dlg.reply(dlg._("Welcome back!"));
            dlg.reply(dlg._("If you need help at any point, try ‘help’."));
        }
    } else {
        prefs.set('sabrina-initialized', true);
        dlg.reply(dlg._("Hello! I'm Almond, your virtual assistant."));

        dlg.reply(dlg._("If you need help at any point, try ‘help’."));

        dlg.reply(dlg._("First of all, I'll need you to configure a Matrix account."));
        dlg.reply(dlg._("I will use this account to contact other Almonds when you ask me to use other people's devices and accounts."));
        yield configureMessaging(dlg);

        dlg.reply(dlg._("Great! Now you can start setting up your other devices and accounts."));
        dlg.reply(dlg._("To do so, try ‘configure‘ followed by the type of device or account (e.g., ‘configure twitter’ or ‘configure tv’), or try ‘discover’ and I'll take a look at what you have."));
    }
};
