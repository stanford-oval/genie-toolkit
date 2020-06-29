// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const baseCanonical = require('../tool/lib/base-canonical-generator');

const TEST_CASES = [
    ['author', Type.Entity('org.schema.Restaurant:Person'), { base: ['author'] }],
    ['datePublished', Type.Date, { base: ['date published'] }],
    ['review', Type.Array(Type.Entity('org.schema.Restaurant:Review')), { base: ['reviews'] }],
    ['servesCuisine', Type.String, { verb: ["serves # cuisine"], base: ["cuisine"] }],
];


function main() {
    let anyFailed = false;
    for (let [name, type, expected] of TEST_CASES) {
        const canonical = baseCanonical({}, name, type);
        try {
            assert.deepStrictEqual(canonical, expected);
        } catch(e) {
            console.error(`Test case "${name}" failed`); //"
            console.error(e);
            anyFailed = true;
        }
    }
    if (anyFailed)
        throw new Error('Some test failed');
}
module.exports = main;
if (!module.parent)
    main();
