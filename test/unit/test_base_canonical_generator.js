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


import assert from 'assert';
import * as ThingTalk from 'thingtalk';
const Type = ThingTalk.Type;

import baseCanonical from '../../tool/autoqa/lib/base-canonical-generator';

const library = ThingTalk.Syntax.parse(`
    class @foo {
        query test1(out from_location: Location, 
                    out to_location: Location);
                    
        query test2(out from_location: Location, 
                    out to_location: String);
                    
        query test3(out by_writer: Entity(tt:person), 
                    out by_singer: Entity(tt:person));
    }
`);
const klass = library.classes[0];

const TEST_CASES = [
    ['author', new Type.Entity('org.schema.Restaurant:Person'), { default: 'property', base: ['author'] }, null],
    ['datePublished', Type.Date, { default: 'property', base: ['date published'] }, null],
    ['review', new Type.Array(new Type.Entity('org.schema.Restaurant:Review')), { default: 'property', base: ['reviews'] }, null],
    ['servesCuisine', Type.String, { default: 'verb', verb: ["serves # cuisine"], base: ["cuisine"] }, null],

    ['inAlbum', new Type.Entity('org.schema:MusicAlbum'), { default: 'preposition', base: ['album'], preposition: ['in', 'in album'] }, null],
    ['byArtist', new Type.Entity('org.schema:Artist'), { default: 'preposition', base: ['artist'], preposition: ['by', 'by artist'] }, null],

    ['from_location', Type.Location, { default: 'preposition', base: ['location'], preposition: ['from', 'from location'] }, null],
    ['to_location', Type.Location, { default: 'preposition', base: ['location'], preposition: ['to', 'to location'] }, null],

    ['from_location', Type.Location, { default: 'preposition', base: ['location'], preposition: ['from', 'from location'] }, klass.queries.test2],
    ['to_location', Type.String, { default: 'preposition', base: ['location'], preposition: ['to', 'to location'] }, klass.queries.test2],

    ['by_writer', new Type.Entity('tt:person'), { default: 'preposition', base: ['writer'], preposition: ['by', 'by writer'] }],
    ['by_singer', new Type.Entity('tt:person'), { default: 'preposition', base: ['singer'], preposition: ['by', 'by singer'] }],

    ['by_writer', new Type.Entity('tt:person'), { default: 'preposition', base: ['writer'], preposition: ['by writer'] }, klass.queries.test3],
    ['by_singer', new Type.Entity('tt:person'), { default: 'preposition', base: ['singer'], preposition: ['by singer'] }, klass.queries.test3],

    ['has_wifi', Type.Boolean, { default: 'property', property_true: ['wifi'], property_false: ['no wifi'] }, null],
    ['refundable', Type.Boolean, { default: 'adjective', adjective_true: ['refundable'] }, null],
    ['is_unisex', Type.Boolean, { default: 'adjective', adjective_true: ['unisex'] }, null]
];


function main() {
    let anyFailed = false;
    for (let [name, type, expected, functionDef] of TEST_CASES) {
        const canonical = {};
        baseCanonical(canonical, name, type, functionDef);
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
export default main;
if (!module.parent)
    main();
