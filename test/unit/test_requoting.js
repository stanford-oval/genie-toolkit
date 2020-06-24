// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const { requoteSentence, requoteProgram } = require('../../lib/dataset-tools/requoting');

const SENTENCE_TEST_CASES = [
    ['tweet hello world', 'now => @com.twitter.post param:status:String = " hello world "', 'tweet QUOTED_STRING'],
    ['tweet QUOTED_STRING_0', 'now => @com.twitter.post param:status:String = QUOTED_STRING_0', 'tweet QUOTED_STRING'],

    ['tweet hello world and then tweet QUOTED_STRING_0', 'foo " hello world " and QUOTED_STRING_0', 'tweet QUOTED_STRING and then tweet QUOTED_STRING'],
    ['tweet hello world and then tweet foo bar', 'foo " hello world " and " foo bar "', 'tweet QUOTED_STRING and then tweet QUOTED_STRING'],
    ['tweet QUOTED_STRING_0 and then tweet foo bar', 'foo QUOTED_STRING_0 and " foo bar "', 'tweet QUOTED_STRING and then tweet QUOTED_STRING'],

    ['tweet QUOTED_STRING_0 and then tweet foo bar and then QUOTED_STRING_1', 'foo QUOTED_STRING_1 and " foo bar " and QUOTED_STRING_0', 'tweet QUOTED_STRING and then tweet QUOTED_STRING and then QUOTED_STRING'],

    ['tweet HASHTAG_0', 'foo HASHTAG_0', 'tweet HASHTAG'],
    ['tweet foo', 'lol " foo " ^^tt:hashtag', 'tweet HASHTAG'],
    ['tweet USERNAME_0', 'foo USERNAME_0', 'tweet USERNAME'],
    ['tweet foo', 'lol " foo " ^^tt:username', 'tweet USERNAME'],
    ['tweet GENERIC_ENTITY_foo:bar_0', 'foo GENERIC_ENTITY_foo:bar_0', 'tweet GENERIC_ENTITY_foo:bar'],
    ['tweet foo', 'lol " foo " ^^foo:bar', 'tweet GENERIC_ENTITY_foo:bar'],

    ['get weather for seattle', 'location: " seattle "', 'get weather for LOCATION'],
    ['get weather for san francisco and foo', 'location: " san francisco "', 'get weather for LOCATION and foo'],
];

function testRequoteSentence() {
    for (let i = 0; i < SENTENCE_TEST_CASES.length; i++) {
        let [sentence, program, expected] = SENTENCE_TEST_CASES[i];

        let generated = Array.from(requoteSentence(i, sentence, program)).join(' ');
        assert.strictEqual(generated, expected);
    }
}

const PROGRAM_TEST_CASES = [
    ['@twitter.tweet NUMBER_0 and NUMBER_1', '@twitter.tweet NUMBER and NUMBER'],
    ['@twitter.tweet NUMBER_1 and NUMBER_0', '@twitter.tweet NUMBER and NUMBER'],

    ['@twitter.tweet QUOTED_STRING_0', '@twitter.tweet QUOTED_STRING'],
    ['@twitter.tweet " foo bar "', '@twitter.tweet QUOTED_STRING'],
    ['@twitter.tweet HASHTAG_0', '@twitter.tweet HASHTAG'],
    ['@twitter.tweet " foo bar " ^^tt:hashtag', '@twitter.tweet HASHTAG'],
    ['@twitter.tweet " foo bar " ^^tt:username', '@twitter.tweet USERNAME'],
    ['@twitter.tweet " foo bar " ^^foo:bar', '@twitter.tweet GENERIC_ENTITY_foo:bar'],

    ['@twitter.tweet " HASHTAG_0 "', '@twitter.tweet QUOTED_STRING'],

    ['@twitter.tweet NUMBER_0 F', '@twitter.tweet NUMBER F'],

    ['@foo.bar LOCATION_0', '@foo.bar LOCATION'],
    ['@foo.bar location: " san francisco "', '@foo.bar LOCATION'],
    ['@foo.bar location:home', '@foo.bar location:home'],
];

function testRequotePrograms() {
    for (let i = 0; i < PROGRAM_TEST_CASES.length; i++) {
        let [program, expected] = PROGRAM_TEST_CASES[i];

        let generated = Array.from(requoteProgram(program)).join(' ');
        assert.strictEqual(generated, expected);
    }
}

async function main() {
    testRequoteSentence();
    testRequotePrograms();
}
module.exports = main;
if (!module.parent)
    main();
