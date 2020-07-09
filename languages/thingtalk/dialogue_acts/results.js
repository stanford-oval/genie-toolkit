// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const {
    isInfoPhraseCompatibleWithResult,
} = require('./common');

function checkInfoPhrase(ctx, info) {
    if (info.schema !== null) {
        if (ctx.currentFunction !== info.schema.class.name + ':' + info.schema.name)
            return null;
    }

    // check that the filter uses the right set of parameters
    if (ctx.resultInfo.projection !== null) {
        // check that all projected names are present
        for (let name of ctx.resultInfo.projection) {
            if (!info.has(name))
                return null;
        }
    } else {
        // we must have at least one result to be here
        let topResult = ctx.results[0];
        assert(topResult);

        // check that the names are part of the #[default_projection], if one is specified
        for (let name of info.keys()) {
            if (!topResult.value[name])
                return null;
        }
    }

    // check that the filter is compatible with at least one of the top 3 results
    let good = false;
    const results = ctx.results;
    for (let i = 0; i < Math.min(3, results.length); i++) {
        if (isInfoPhraseCompatibleWithResult(results[i], info)) {
            good = true;
            break;
        }
    }

    if (good) {
        if (info.schema !== null)
            return info;

        const clone = info.clone();
        clone.schema = ctx.currentFunctionSchema;
        return clone;
    } else {
        return null;
    }
}

module.exports = {
    checkInfoPhrase
};
