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


import assert from 'assert';

import { requoteSentence, requoteProgram, getFunctions, getDevices } from '../../lib/dataset-tools/requoting';

const SENTENCE_TEST_CASES = [
    // legacy syntax
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


    // new syntax
    ['tweet hello world', 'now => @com.twitter.post ( status = " hello world " ) ;', 'tweet QUOTED_STRING'],
    ['tweet QUOTED_STRING_0', 'now => @com.twitter.post ( status = QUOTED_STRING_0 ) ;', 'tweet QUOTED_STRING'],

    ['tweet hello world and then tweet QUOTED_STRING_0', 'foo " hello world " && QUOTED_STRING_0', 'tweet QUOTED_STRING and then tweet QUOTED_STRING'],
    ['tweet hello world and then tweet foo bar', 'foo " hello world " && " foo bar "', 'tweet QUOTED_STRING and then tweet QUOTED_STRING'],
    ['tweet QUOTED_STRING_0 and then tweet foo bar', 'foo QUOTED_STRING_0 && " foo bar "', 'tweet QUOTED_STRING and then tweet QUOTED_STRING'],

    ['tweet QUOTED_STRING_0 and then tweet foo bar and then QUOTED_STRING_1', 'foo QUOTED_STRING_1 && " foo bar " and QUOTED_STRING_0', 'tweet QUOTED_STRING and then tweet QUOTED_STRING and then QUOTED_STRING'],

    ['tweet HASHTAG_0', 'foo HASHTAG_0', 'tweet HASHTAG'],
    ['tweet foo', 'lol " foo " ^^tt:hashtag ;', 'tweet HASHTAG'],
    ['tweet USERNAME_0', 'foo USERNAME_0', 'tweet USERNAME'],
    ['tweet foo', 'lol " foo " ^^tt:username ;', 'tweet USERNAME'],
    ['tweet GENERIC_ENTITY_foo:bar_0', 'foo GENERIC_ENTITY_foo:bar_0', 'tweet GENERIC_ENTITY_foo:bar'],
    ['tweet foo', 'lol null ( " foo " ^^foo:bar ) ;', 'tweet GENERIC_ENTITY_foo:bar'],

    ['get weather for seattle', 'new Location ( " seattle " ) ;', 'get weather for LOCATION'],
    ['get weather for san francisco and foo', 'new Location ( " san francisco " ) ;', 'get weather for LOCATION and foo'],
];

function testRequoteSentence() {
    for (let i = 0; i < SENTENCE_TEST_CASES.length; i++) {
        let [sentence, program, expected] = SENTENCE_TEST_CASES[i];

        let generated = Array.from(requoteSentence(i, sentence, program)).join(' ');
        assert.strictEqual(generated, expected);
    }
}

const PROGRAM_TEST_CASES = [
    // legacy syntax
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

    // new syntax
    ['@twitter.tweet ( HASHTAG_0 )', '@twitter.tweet ( HASHTAG )'],
    ['@twitter.tweet ( " foo bar " ^^tt:hashtag )', '@twitter.tweet ( HASHTAG )'],
    ['@twitter.tweet ( " foo bar " ^^tt:username )', '@twitter.tweet ( USERNAME )'],
    ['@twitter.tweet ( null ^^foo:bar ( " foo bar " ) )', '@twitter.tweet ( GENERIC_ENTITY_foo:bar )'],

    ['@twitter.tweet ( " HASHTAG_0 " )', '@twitter.tweet ( QUOTED_STRING )'],

    ['@foo.bar ( LOCATION_0 )', '@foo.bar ( LOCATION )'],
    ['@foo.bar ( new Location ( " san francisco " ) )', '@foo.bar ( LOCATION )'],
    ['@foo.bar ( $location . home )', '@foo.bar ( $location . home )'],
];

function testRequotePrograms() {
    for (let i = 0; i < PROGRAM_TEST_CASES.length; i++) {
        let [program, expected] = PROGRAM_TEST_CASES[i];

        let generated = Array.from(requoteProgram(program)).join(' ');
        assert.strictEqual(generated, expected);
    }
}

const FUNCTION_TEST_CASES = [
    ['@com.twitter . post ( status = " hello world " ) ;', '@com.twitter.post'],
    ['$dialogue @org.thingpedia.dialogue.transaction . execute ; @foo.bar . baz ( status = QUOTED_STRING_0 ) ;', '@foo.bar.baz'],
    ['$dialogue @dialogue.policy . execute ; @foo.bar . baz ( status = " $dialogue string " ) ; @baz.bar . foo ( location ) ;', '@foo.bar.baz @baz.bar.foo']
];

function testGetFunctions() {
    for (let i = 0; i < FUNCTION_TEST_CASES.length; i++) {
        let [program, expected] = FUNCTION_TEST_CASES[i];

        let generated = Array.from(getFunctions(program)).join(' ');
        assert.strictEqual(generated, expected);
    }
}

const DEVICE_TEST_CASES = [
    ['@com.twitter . post ( status = " hello world " ) ;', '@com.twitter'],
    ['$dialogue @org.thingpedia.dialogue.transaction . execute ; @foo.bar . baz ( status = QUOTED_STRING_0 ) ;', '@foo.bar'],
    ['$dialogue @dialogue.policy . execute ; @foo.bar . baz ( status = " $dialogue string " ) ; @baz.bar . foo ( location ) ;', '@foo.bar @baz.bar']
];

function testGetDevices() {
    for (let i = 0; i < DEVICE_TEST_CASES.length; i++) {
        let [program, expected] = DEVICE_TEST_CASES[i];

        let generated = Array.from(getDevices(program)).join(' ');
        assert.strictEqual(generated, expected);
    }
}

async function main() {
    testRequoteSentence();
    testRequotePrograms();
    testGetFunctions();
    testGetDevices();
}
export default main;
if (!module.parent)
    main();
