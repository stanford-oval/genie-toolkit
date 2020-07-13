// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
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
