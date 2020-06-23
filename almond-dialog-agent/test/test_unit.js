// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2018 Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// Miscellaneous unit tests, for simple code fragments that don't need
// a lot of mocking and fixtures

const assert = require('assert');
const ThingTalk = require('thingtalk');
const _mockThingpediaClient = require('./mock_schema_delegate');

const Helpers = require('../lib/helpers');

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
        [`class @__dyn_0 extends @org.thingpedia.builtin.thingengine.remote {
    action send(in req __principal: Entity(tt:contact),
                in req __program_id: Entity(tt:program_id),
                in req __flow: Number,
                in req __kindChannel: Entity(tt:function),
                in req title: String,
                in req picture_url: Entity(tt:picture),
                in req link: Entity(tt:url),
                in req alt_text: String);
  }
  now => @com.xkcd.get_comic() => @__dyn_0.send(__principal="mock-account:123456-SELF"^^tt:contact("me"), __program_id=$event.program_id, __flow=0, __kindChannel=$event.type, title=title, picture_url=picture_url, link=link, alt_text=alt_text);`, 'com.xkcd'],
    ];

    const schemas = new ThingTalk.SchemaRetriever(_mockThingpediaClient, null, true);

    for (let [code, expected] of TEST_CASES) {
        const program = await ThingTalk.Grammar.parseAndTypecheck(code, schemas, false);

        const icon = Helpers.getProgramIcon(program);
        assert.strictEqual(icon, expected);
    }
}

async function main() {
    await testCleanKind();
    await testGetIcon();
}
module.exports = main;
if (!module.parent)
    main();

