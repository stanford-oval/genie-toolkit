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

const Helpers = require('./helpers');

const ENABLE_SUGGESTIONS = false;

async function getFallbackExamples(dlg, command) {
    const dataset = await dlg.manager.thingpedia.getExamplesByKey(command);
    const examples = ENABLE_SUGGESTIONS ? await Helpers.loadExamples(dataset, dlg.manager.schemas, 5) : [];

    if (examples.length === 0) {
        await dlg.reply(dlg._("Sorry, I did not understand that."));
        return;
    }

    dlg.manager.stats.hit('sabrina-fallback-buttons');

    // don't sort the examples, they come already sorted from Thingpedia

    await dlg.reply(dlg._("Sorry, I did not understand that. Try the following instead:"));
    Helpers.presentExampleList(dlg, examples);
}

module.exports = {
    getFallbackExamples
};
