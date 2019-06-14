// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const { promptConfigure } = require('./device_choice');

module.exports = {
    configureMessaging(dlg) {
        return promptConfigure(dlg, 'messaging');
    },

    ensureMessagingConfigured(dlg) {
        if (!dlg.manager.messaging.isAvailable) {
            dlg.reply(dlg._("You haven't configured a Matrix account yet. You need a Matrix account to let me talk to other Almonds."));
            dlg.replyLink(dlg._("Register a new Matrix account"), 'https://riot.im/app/#/register');
            return promptConfigure(dlg, 'org.thingpedia.builtin.matrix');
        } else {
            return Promise.resolve();
        }
    }
};
