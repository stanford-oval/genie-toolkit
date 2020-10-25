// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018 Google LLC
//           2020 The Board of Trustees of the Leland Stanford Junior University
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


// Miscellaneous unit tests, for simple code fragments that don't need
// a lot of mocking and fixtures

import assert from 'assert';
import * as ThingTalk from 'thingtalk';
import _mockThingpediaClient from './mock_schema_delegate';

import * as Helpers from '../../lib/dialogue-agent/helpers';
import { getProgramIcon } from '../../lib/utils/icons';

function testCleanKind() {
    assert.strictEqual(Helpers.cleanKind('uk.co.thedogapi'), 'Thedogapi');
    assert.strictEqual(Helpers.cleanKind('org.thingpedia.weather'), 'Weather');
    assert.strictEqual(Helpers.cleanKind('com.bing'), 'Bing');
    assert.strictEqual(Helpers.cleanKind('gov.nasa'), 'Nasa');
    assert.strictEqual(Helpers.cleanKind('org.thingpedia.builtin.test'), 'Test');
    assert.strictEqual(Helpers.cleanKind('org.thingpedia.builtin.thingengine.phone'), 'Phone');
    assert.strictEqual(Helpers.cleanKind('org.coinbin'), 'Coinbin');

    assert.strictEqual(Helpers.cleanKind('com.made.up'), 'Made Up');
    assert.strictEqual(Helpers.cleanKind('com.two-words'), 'Two Words');
    assert.strictEqual(Helpers.cleanKind('org.under_score'), 'Under Score');
}

async function testGetIcon() {
    const TEST_CASES = [
        [`now => @com.twitter.post(status="foo");`, 'com.twitter'],
        [`now => @com.twitter.home_timeline() => notify;`, 'com.twitter'],
        [`now => @org.thingpedia.builtin.thingengine.builtin.say(message="foo");`, null],
        [`now => @com.twitter.home_timeline() => @org.thingpedia.builtin.thingengine.builtin.say(message=text);`, 'com.twitter'],
        [`now => @com.twitter.home_timeline() => @com.facebook.post(status=text);`, 'com.facebook'],
        [`now => @org.thingpedia.builtin.thingengine.builtin.get_random_between() => @com.twitter.post(status="foo");`, 'com.twitter'],
    ];

    const schemas = new ThingTalk.SchemaRetriever(_mockThingpediaClient, null, true);

    for (let [code, expected] of TEST_CASES) {
        const program = await ThingTalk.Grammar.parseAndTypecheck(code, schemas, false);

        const icon = getProgramIcon(program);
        assert.strictEqual(icon, expected);
    }
}

async function main() {
    await testCleanKind();
    await testGetIcon();
}
export default main;
if (!module.parent)
    main();

