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

const DiscoveryDelegate = require('./discovery_delegate');

function configureMessaging(dlg) {
    return dlg.manager.devices.factory.getFactory('org.thingpedia.builtin.matrix').then((factory) => {
        const delegate = new DiscoveryDelegate(dlg, 'online');

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

module.exports = {
    configureMessaging,

    ensureMessagingConfigured(dlg) {
        if (!dlg.manager.messaging.isAvailable) {
            dlg.reply(dlg._("You haven't configured a Matrix account yet. You need a Matrix account to let me talk to other Almonds."));
            return configureMessaging(dlg);
        } else {
            return Promise.resolve();
        }
    }
};