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

const configDialog = require('./config');

module.exports = {
    configureMessaging(dlg) {
        return configDialog(dlg, 'messaging');
    },

    async ensureMessagingConfigured(dlg) {
        if (!dlg.manager.messaging.isAvailable) {
            await dlg.reply(dlg._("You need a Matrix account: I talk to other Almonds via the secure Matrix messaging service."));
            await dlg.replyLink(dlg._("Register a new Matrix account now"), 'https://riot.im/app/#/register');
            const newDevice = await configDialog(dlg, 'org.thingpedia.builtin.matrix');
            return newDevice !== null;
        } else {
            return true;
        }
    }
};
