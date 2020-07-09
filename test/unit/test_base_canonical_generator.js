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

const baseCanonical = require('../../tool/autoqa/lib/base-canonical-generator');

const TEST_CASES = [
    ['author', Type.Entity('org.schema.Restaurant:Person'), { default: 'property', base: ['author'] }],
    ['datePublished', Type.Date, { default: 'property', base: ['date published'] }],
    ['review', Type.Array(Type.Entity('org.schema.Restaurant:Review')), { default: 'property', base: ['reviews'] }],
    ['servesCuisine', Type.String, { default: 'verb', verb: ["serves # cuisine"], base: ["cuisine"] }],

    ['from_location', Type.Location, { default: 'passive_verb', base: ['from location'], passive_verb: ['from'] }],
    ['to_location', Type.Location, { default: 'passive_verb', base: ['to location'], passive_verb: ['to'] }],

    ['has_wifi', Type.Boolean, { default: 'property', property_true: ['wifi'], property_false: ['no wifi'] } ],
    ['refundable', Type.Boolean, { default: 'adjective', adjective_true: ['refundable'] }],
    ['is_unisex', Type.Boolean, { default: 'adjective', adjective_true: ['unisex'] }]
];


function main() {
    let anyFailed = false;
    for (let [name, type, expected] of TEST_CASES) {
        const canonical = {};
        baseCanonical(canonical, name, type);
        try {
            assert.deepStrictEqual(canonical, expected);
        } catch(e) {
            console.error(`Test case "${name}" failed`);
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
