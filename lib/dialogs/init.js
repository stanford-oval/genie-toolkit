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
const { ValueCategory } = require('../semantic');

const { ensureMessagingConfigured } = require('./messaging');

module.exports = async function initDialog(dlg, showWelcome, forceConfigureMatrix) {
    if (!showWelcome)
        return;

    var prefs = dlg.manager.platform.getSharedPreferences();
    var initialized = prefs.get('sabrina-initialized') && prefs.get('sabrina-store-log') !== undefined;

    if (dlg.manager.isAnonymous) {
        await dlg.reply(dlg._("Hello! I'm Almond, your virtual assistant."));
        await dlg.reply(dlg._("I am part of a research project of Stanford University. I am capable of understanding actions and events over web services."));

        await dlg.reply(dlg._("Please keep in mind: I do not chat, and I do not understand questions very well. Please check out the Thingpedia to find out what I understand, or type ‘help’."));
        await dlg.reply(dlg._("To start, how about you try one of these examples:"));

        await Helpers.presentExampleList(dlg, [
            { utterance: 'get a #cat gif',
              target: { code: ('now => @com.giphy.get param:tag:Entity(tt:hashtag) = HASHTAG_0 => notify'.split(' ')),
                        entities: { HASHTAG_0: 'cat' } } },
            { utterance: 'show me the weather for San Francisco',
              target: { code: ('now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify'.split(' ')),
                        entities: {
                            "LOCATION_0": {"latitude": 37.7792808, "longitude": -122.4192363, "display": "San Francisco, San Francisco City and County, California, United States of America"}
                        } } },
            { utterance: 'search almond recipes on YouTube',
              target: { code: ('now => @com.youtube.search_videos param:query:String = QUOTED_STRING_0 => notify').split(' '),
                        entities: { QUOTED_STRING_0: 'almond recipes' } } },
            { utterance: 'translate a sentence to Chinese',
              target: { code: ["now", "=>", "@com.yandex.translate.translate", "param:target_language:Entity(tt:iso_lang_code)", "=", "GENERIC_ENTITY_tt:iso_lang_code_0", "=>", "notify"],
                        entities: {"GENERIC_ENTITY_tt:iso_lang_code_0": {"value": "zh", "display": "Chinese"}} } }
        ]);
    } else if (initialized) {
        await dlg.reply(dlg._("Welcome back!"));

        if (forceConfigureMatrix) {
            try {
                await ensureMessagingConfigured(dlg);
            } catch(e) {
                if (e.code === 'ECANCELLED')
                    throw e;
                console.error(e.stack);
                await dlg.reply(dlg._("Sorry, that did not work: %s").format(e.message));
                await dlg.reply(dlg._("You should try again later."));
            }
        }
    } else {
        prefs.set('sabrina-initialized', true);
        await dlg.reply(dlg._("Hello! I'm Almond, your virtual assistant."));

        if (dlg.manager.platform.type === 'cloud') {
            await dlg.reply(dlg._("I am part of a research project of Stanford University. I am capable of understanding actions and events over web services."));
            await dlg.reply(dlg._("Please keep in mind: I do not chat, and I do not understand questions very well. Please check out the Thingpedia to find out what I understand, or type ‘help’."));
            prefs.set('sabrina-store-log', 'yes');
        } else {
            await dlg.reply(dlg._("I am part of a research project of Stanford University. Would you like to participate?"));
            await dlg.reply(dlg._("With your consent, I will record the commands you give me for training. Recording the commands will allow me to improve my understanding of natural language. I will collect what you type, not your data, or what I reply."));
            await dlg.reply(dlg._("If you would like to participate, please review our consent form, and keep it for your records:"));
            await dlg.replyRDL({
                displayTitle: dlg._("Consent Form"),
                webCallback: 'https://oval.cs.stanford.edu/almond-consent-form.html',
                callback: 'https://oval.cs.stanford.edu/almond-consent-form.html',
            });
            prefs.set('sabrina-store-log', 'no');
            let agreeToCollection = false;
            try {
                agreeToCollection = await dlg.ask(ValueCategory.YesNo, dlg._("Do you consent to recording your commands?"));
            } catch(e) {
                if (e.code !== 'ECANCELLED')
                    throw e;
            }
            prefs.set('sabrina-store-log', agreeToCollection ? 'yes' : 'no');

            if (agreeToCollection)
                await dlg.reply(dlg._("Thank you! If you change your mind, you can change the option from Settings."));
            else
                await dlg.reply(dlg._("Okay, I will not store any command from this Almond. If you change your mind, you can change the option from Settings."));

            await dlg.reply(dlg._("Okay, on to what I can do: I am capable of understanding actions and events over web services and smart devices. I do not chat, and I do not understand questions very well. Please check out the Cheatsheet (from the menu) to find out what I understand, or type ‘help’."));
        }

        //await dlg.reply(dlg._("You can also configure your personal accounts. To do so, try ‘configure‘ followed by the type of account (e.g., ‘configure twitter’ or ‘configure nest’)."));
        //await dlg.reply(dlg._("If you need help at any point, try ‘help’."));

        await dlg.reply(dlg._("To start, how about you try one of these examples:"));

        await Helpers.presentExampleList(dlg, [
            { utterance: 'get a #cat gif',
              target: { code: ('now => @com.giphy.get param:tag:Entity(tt:hashtag) = HASHTAG_0 => notify'.split(' ')),
                        entities: { HASHTAG_0: 'cat' } } },
            { utterance: 'show me the weather for San Francisco',
              target: { code: ('now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify'.split(' ')),
                        entities: {
                            "LOCATION_0": {"latitude": 37.7792808, "longitude": -122.4192363, "display": "San Francisco, San Francisco City and County, California, United States of America"}
                        } } },
            { utterance: 'search almond recipes on bing',
              target: { code: ('now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify').split(' '),
                        entities: { QUOTED_STRING_0: 'almond recipes' } } },
            { utterance: 'translate a sentence to Chinese',
              target: { code: ["now", "=>", "@com.yandex.translate.translate", "param:target_language:Entity(tt:iso_lang_code)", "=", "GENERIC_ENTITY_tt:iso_lang_code_0", "=>", "notify"],
                        entities: {"GENERIC_ENTITY_tt:iso_lang_code_0": {"value": "zh", "display": "Chinese"}} } }
        ]);
    }
};
