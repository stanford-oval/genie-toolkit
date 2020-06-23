// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const GenieBasedPolicy = require('./genie-based');
const NullPolicy = require('./null');

module.exports = {
    'org.thingpedia.dialogue.transaction'(dlg) {
        return (new GenieBasedPolicy(dlg, [require.resolve('genie-toolkit/languages/thingtalk/en/dialogue.genie')])).init();
    },

    'org.thingpedia.dialogue.null'(dlg) {
        return new NullPolicy();
    },
};
