// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>
//
// See COPYING for details


import assert from 'assert';

import { requoteSentence } from '../../tool/requote';


const SINGLE_TURN_TEST_CASES = [
    [
        'i would like to find out more about queen college .',
        '... filter param:id =~ " queen college " => notify ;',
        'i would like to find out more about QUOTED_STRING_0 .',
        '... filter param:id =~ QUOTED_STRING_0 => notify ;'
    ],

    [
        'i would like to find out more about queen colleges .',
        '... filter param:id =~ " queen college " => notify ;',
        'i would like to find out more about QUOTED_STRING_0 .',
        '... filter param:id =~ QUOTED_STRING_0 => notify ;'
    ],

    [
        'i would like to find out more about the queen college .',
        '... filter param:id =~ " queen college " => notify ;',
        'i would like to find out more about QUOTED_STRING_0 .',
        '... filter param:id =~ QUOTED_STRING_0 => notify ;'
    ],

    [
        'amazon are sunlight lounge rated a 1 star with summary being what .',
        '... filter param:aggregateRating.ratingValue:Number == 1 and param:name:String =~ " sunlight lounge " => notify',
        'amazon are QUOTED_STRING_0 rated a NUMBER_0 star with summary being what .',
        '... filter param:aggregateRating.ratingValue:Number == NUMBER_0 and param:name:String =~ QUOTED_STRING_0 => notify'
    ],


    [
        'amazon are sunlight lounge rated a one star with summary being what .',
        '... filter param:aggregateRating.ratingValue:Number == 1 and param:name:String =~ " sunlight lounge " => notify',
        'amazon are QUOTED_STRING_0 rated a one star with summary being what .',
        '... filter param:aggregateRating.ratingValue:Number == 1 and param:name:String =~ QUOTED_STRING_0 => notify'
    ],


    [
        'amazon are sunlight lounge rated 15 stars with summary being what .',
        '... filter param:aggregateRating.ratingValue:Number == 15 => notify',
        'amazon are sunlight lounge rated NUMBER_0 stars with summary being what .',
        '... filter param:aggregateRating.ratingValue:Number == NUMBER_0 => notify'
    ],

    [
        'i am looking for multiple sports in sport city',
    '... filter param:id: " sport " and param:area == " sport " and param:type =~ " multiple sports " => notify ;',
        'i am looking for QUOTED_STRING_0 in QUOTED_STRING_1 city',
        '... filter param:id: QUOTED_STRING_1 and param:area == QUOTED_STRING_1 and param:type =~ QUOTED_STRING_0 => notify ;'
    ],

    [
        'i am looking for multiple sports in sports city',
    '... filter param:id: " sport " and param:area == " sport " and param:type =~ " multiple sports " => notify ;',
    'i am looking for QUOTED_STRING_0 in QUOTED_STRING_1 city',
    '... filter param:id: QUOTED_STRING_1 and param:area == QUOTED_STRING_1 and param:type =~ QUOTED_STRING_0 => notify ;'
    ]

];

const CONTEXTUAL_TEST_CASES = [
    [
        '... filter param:food =~ QUOTED_STRING_0 ... ;',
        'yes , how about a chinese restaurant ?',
        '... filter param:food =~ " chinese " ...',
        'yes , how about a QUOTED_STRING_1 restaurant ?',
        '... filter param:food =~ QUOTED_STRING_1 ...'
    ],

    [
        '... filter param:food =~ QUOTED_STRING_0 ... ;',
        'yes , how about that ?',
        '... filter param:food =~ QUOTED_STRING_0 ...',
        'yes , how about that ?',
        '... filter param:food =~ QUOTED_STRING_0 ...'
    ],


    [
        '... filter param:departure =~ QUOTED_STRING_1 and param:destination =~ QUOTED_STRING_0 ... param:arrive_by = TIME_0 , param:leave_at = TIME_1 ...',
        'i would like to arrive in cambridge by TIME_2 on wednesday .',
        '... filter param:arrive_by <= TIME_2 ... and param:departure =~ QUOTED_STRING_1 and param:destination =~ " cambridge " => notify ;',
        'i would like to arrive in QUOTED_STRING_2 by TIME_2 on wednesday .',
        '... filter param:arrive_by <= TIME_2 ... and param:departure =~ QUOTED_STRING_1 and param:destination =~ QUOTED_STRING_2 => notify ;'
    ],


    [
        '... filter param:departure =~ QUOTED_STRING_1 and param:destination =~ QUOTED_STRING_0 ... param:arrive_by = TIME_0 , param:leave_at = TIME_1 ...',
        'i would like to arrive by TIME_2 on wednesday .',
        '... filter param:arrive_by <= TIME_2 ... and param:departure =~ QUOTED_STRING_1 and param:destination =~ QUOTED_STRING_0 => notify ;',
        'i would like to arrive by TIME_2 on wednesday .',
        '... filter param:arrive_by <= TIME_2 ... and param:departure =~ QUOTED_STRING_1 and param:destination =~ QUOTED_STRING_0 => notify ;'
    ],


    [
        '... param:departure = QUOTED_STRING_0 , param:destination = QUOTED_STRING_1 , param:id = GENERIC_ENTITY_uk.ac.cam.multiwoz.Train:Train_0 ...',
        'what is the price of tr5695 train ?',
        '... param:departure =~ QUOTED_STRING_0 and param:destination =~ QUOTED_STRING_1 and param:id =~ " tr5695 " ) => notify ;',
        'what is the price of QUOTED_STRING_2 train ?',
        '... param:departure =~ QUOTED_STRING_0 and param:destination =~ QUOTED_STRING_1 and param:id =~ QUOTED_STRING_2 ) => notify ;'
    ],


];


function testRequoteSingleTurn(mode) {
    for (let i = 0; i < SINGLE_TURN_TEST_CASES.length; i++) {
        let [sentence, program, expectedSentence, expectedProgram] = SINGLE_TURN_TEST_CASES[i];

        let [generatedSentence, generatedProgram] = requoteSentence(i, null, sentence, program,
            'replace', true, true, 'en-US');
        assert.strictEqual(generatedSentence, expectedSentence);
        assert.strictEqual(generatedProgram, expectedProgram);
    }
}

function testRequoteContextual() {
    for (let i = 0; i < CONTEXTUAL_TEST_CASES.length; i++) {
        let [context, sentence, program, expectedSentence, expectedProgram] = CONTEXTUAL_TEST_CASES[i];

        let [generatedSentence, generatedProgram] = requoteSentence(i, context, sentence, program,
            'replace', true, true, 'en-US');
        assert.strictEqual(generatedSentence, expectedSentence);
        assert.strictEqual(generatedProgram, expectedProgram);

    }
}


async function main() {
        testRequoteSingleTurn();
        testRequoteContextual();
}
export default main;
if (!module.parent)
    main();
