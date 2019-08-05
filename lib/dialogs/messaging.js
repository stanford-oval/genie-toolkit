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

    async ensureMessagingConfigured(dlg) {
        if (!dlg.manager.messaging.isAvailable) {
            dlg.reply(dlg._("You need a Matrix account: I talk to other Almonds via the secure Matrix messaging service."));
            dlg.replyLink(dlg._("Register a new Matrix account now"), 'https://riot.im/app/#/register');
            const newDevice = await promptConfigure(dlg, 'org.thingpedia.builtin.matrix');
            return newDevice !== null;
        } else {
            return true;
        }
    }
};
