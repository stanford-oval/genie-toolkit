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
const Helpers = require('../helpers');

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

module.exports = function* initDialog(dlg, showWelcome, forceConfigureMatrix) {
    var prefs = dlg.manager.platform.getSharedPreferences();
    var initialized = prefs.get('sabrina-initialized');

    if (dlg.manager.isAnonymous) {
        dlg.reply(dlg._("Hello! I'm Almond, your virtual assistant."));
        dlg.reply(dlg._("To start, how about you try one of these examples:"));

        yield Helpers.presentExampleList(dlg, [
            { utterance: 'get a #cat gif',
              target: { code: ('now => @com.giphy.get param:tag:Entity(tt:hashtag) = HASHTAG_0 => notify'.split(' ')),
                        entities: { HASHTAG_0: 'cat' } } },
            { utterance: 'show me the weather for San Francisco',
              target: { code: ('now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify'.split(' ')),
                        entities: {
                            "LOCATION_0": {"latitude": 37.7792808, "longitude": -122.4192363, "display": "San Francisco, San Francisco City and County, California, United States of America"}
                        } } },
            { utterance: 'search "almond recipes" on YouTube',
              target: { code: ('now => @com.youtube.search_videos param:query:String = QUOTED_STRING_0 => notify').split(' '),
                        entities: { QUOTED_STRING_0: 'almond recipes' } } },
            { utterance: 'translate a sentence to Chinese',
              target: { code: ["now", "=>", "@com.yandex.translate.translate", "param:target_language:Entity(tt:iso_lang_code)", "=", "GENERIC_ENTITY_tt:iso_lang_code_0", "=>", "notify"],
                        entities: {"GENERIC_ENTITY_tt:iso_lang_code_0": {"value": "zh", "display": "Chinese"}} } }
        ]);
    } else if (initialized) {
        if (forceConfigureMatrix && !dlg.manager.messaging.isAvailable) {
            dlg.reply(dlg._("Welcome back!"));
            dlg.reply(dlg._("You haven't configured a Matrix account yet. You need a Matrix account to let me talk to other Almonds."));
            yield configureMessaging(dlg);
        } else if (showWelcome) {
            dlg.reply(dlg._("Welcome back!"));
        }
    } else {
        prefs.set('sabrina-initialized', true);
        dlg.reply(dlg._("Hello! I'm Almond, your virtual assistant."));

        if (forceConfigureMatrix && dlg.manager.messaging.isAvailable) {
            dlg.reply(dlg._("First of all, I'll need you to configure a Matrix account."));
            dlg.reply(dlg._("I will use this account to contact other Almonds when you ask me to use other people's devices and accounts."));
            yield configureMessaging(dlg);

            dlg.reply(dlg._("Great! Now you can start setting up your other devices and accounts."));
            dlg.reply(dlg._("To do so, try ‘configure‘ followed by the type of device or account (e.g., ‘configure twitter’ or ‘configure tv’), or try ‘discover’ and I'll take a look at what you have."));
        } else {
            dlg.reply(dlg._("First of all, I will help you set up your devices and accounts."));
            dlg.reply(dlg._("To do so, try ‘configure‘ followed by the type of device or account (e.g., ‘configure twitter’ or ‘configure tv’), or try ‘discover’ and I'll take a look at what you have."));

            dlg.reply(dlg._("If you need help at any point, try ‘help’."));
        }
    }
};
