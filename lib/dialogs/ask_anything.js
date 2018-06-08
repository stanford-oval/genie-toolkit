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

const { slotFillCustom } = require('./slot_filling');

module.exports = async function askAnything(dlg, appId, icon, type, question) {
    let app;
    if (appId !== undefined)
        app = dlg.manager.apps.getApp(appId);
    else
        app = undefined;
    if (app)
        question = this._("Question from %s: %s").format(app.name, question);

    dlg.icon = icon;
    let value = await slotFillCustom(dlg, type, question);
    return value.toJS();
};
