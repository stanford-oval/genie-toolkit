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
// Author: Silei Xu <silei@cs.stanford.edu>
"use strict";

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const baseCanonical = require('../../tool/autoqa/lib/base-canonical-generator');

const TEST_CASES = [
    ['author', new Type.Entity('org.schema.Restaurant:Person'), { default: 'property', base: ['author'] }],
    ['datePublished', Type.Date, { default: 'property', base: ['date published'] }],
    ['review', new Type.Array(new Type.Entity('org.schema.Restaurant:Review')), { default: 'property', base: ['reviews'] }],
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
