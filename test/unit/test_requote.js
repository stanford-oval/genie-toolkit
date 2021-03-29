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


const SINGLE_TURN_TEST_CASES_LEGACY = [
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
        'amazon are QUOTED_STRING_0 rated a 1 star with summary being what .',
        '... filter param:aggregateRating.ratingValue:Number == 1 and param:name:String =~ QUOTED_STRING_0 => notify'
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
        '... filter param:id =~ " sport " and param:area == " sport " and param:type =~ " multiple sports " => notify ;',
        'i am looking for QUOTED_STRING_0 in QUOTED_STRING_1 city',
        '... filter param:id =~ QUOTED_STRING_1 and param:area == QUOTED_STRING_1 and param:type =~ QUOTED_STRING_0 => notify ;'
    ],

    [
        'i am looking for multiple sports in sports city',
        '... filter param:id =~ " sport " and param:area == " sport " and param:type =~ " multiple sports " => notify ;',
        'i am looking for QUOTED_STRING_0 in QUOTED_STRING_1 city',
        '... filter param:id =~ QUOTED_STRING_1 and param:area == QUOTED_STRING_1 and param:type =~ QUOTED_STRING_0 => notify ;'
    ],

    [
        'weather for san francisco .',
        '... param:location = location: " san francisco " ;',
        'weather for LOCATION_0 .',
        '... param:location = LOCATION_0 ;'
    ],

    [
        'tweets with hashtag cat .',
        '... param:hashtags contains " cat " ^^tt:hashtag ;',
        'tweets with hashtag HASHTAG_0 .',
        '... param:hashtags contains HASHTAG_0 ;'
    ],

    [
        'italian restaurants .',
        '... param:cuisines contains " italian " ^^com.yelp:restaurant_cuisine ;',
        'GENERIC_ENTITY_com.yelp:restaurant_cuisine_0 restaurants .',
        '... param:cuisines contains GENERIC_ENTITY_com.yelp:restaurant_cuisine_0 ;'
    ],

    [
        'name the restaurant rated 4 or below with a minimum of 150 reviews .',
        'now => ( @org.schema.Restaurant.Restaurant ) filter count ( param:review:Array(Entity(org.schema.Restaurant:Review)) ) >= 150 and param:aggregateRating.ratingValue:Number <= 4 => notify',
        'name the restaurant rated NUMBER_0 or below with a minimum of NUMBER_1 reviews .',
        'now => ( @org.schema.Restaurant.Restaurant ) filter count ( param:review:Array(Entity(org.schema.Restaurant:Review)) ) >= NUMBER_1 and param:aggregateRating.ratingValue:Number <= NUMBER_0 => notify',
    ]
];

const SINGLE_TURN_TEST_CASES_NEW = [
    [
        'i would like to find out more about queen college .',
        '... filter id =~ " queen college " ;',
        'i would like to find out more about QUOTED_STRING_0 .',
        '... filter id =~ QUOTED_STRING_0 ;'
    ],

    [
        'i would like to find out more about queen colleges .',
        '... filter id =~ " queen college " ;',
        'i would like to find out more about QUOTED_STRING_0 .',
        '... filter id =~ QUOTED_STRING_0 ;'
    ],

    [
        'i would like to find out more about the queen college .',
        '... filter id =~ " queen college " ;',
        'i would like to find out more about QUOTED_STRING_0 .',
        '... filter id =~ QUOTED_STRING_0 ;'
    ],

    [
        'amazon are sunlight lounge rated a 1 star with summary being what .',
        '... filter aggregateRating.ratingValue == 1 && name =~ " sunlight lounge " => notify',
        'amazon are QUOTED_STRING_0 rated a 1 star with summary being what .',
        '... filter aggregateRating.ratingValue == 1 && name =~ QUOTED_STRING_0 => notify'
    ],


    [
        'amazon are sunlight lounge rated 15 stars with summary being what .',
        '... filter aggregateRating.ratingValue:Number == 15 => notify',
        'amazon are sunlight lounge rated NUMBER_0 stars with summary being what .',
        '... filter aggregateRating.ratingValue:Number == NUMBER_0 => notify'
    ],

    [
        'i am looking for multiple sports in sport city',
        '... filter id " sport " && area == " sport " && type =~ " multiple sports " => notify ;',
        'i am looking for QUOTED_STRING_0 in QUOTED_STRING_1 city',
        '... filter id QUOTED_STRING_1 && area == QUOTED_STRING_1 && type =~ QUOTED_STRING_0 => notify ;'
    ],

    [
        'i am looking for multiple sports in sports city',
        '... filter id =~ " sport " && area == " sport " && type =~ " multiple sports " => notify ;',
        'i am looking for QUOTED_STRING_0 in QUOTED_STRING_1 city',
        '... filter id =~ QUOTED_STRING_1 && area == QUOTED_STRING_1 && type =~ QUOTED_STRING_0 => notify ;'
    ],

    [
        'weather for san francisco .',
        '... location = new Location ( " san francisco " ) ) ;',
        'weather for LOCATION_0 .',
        '... location = LOCATION_0 ) ;'
    ],

    [
        'tweets with hashtag cat .',
        '... contains ( hashtags , " cat " ^^tt:hashtag ) ;',
        'tweets with hashtag HASHTAG_0 .',
        '... contains ( hashtags , HASHTAG_0 ) ;'
    ],

    [
        'italian restaurants .',
        '... contains ( cuisines , null ^^com.yelp:restaurant_cuisine ( " italian " ) ) ;',
        'GENERIC_ENTITY_com.yelp:restaurant_cuisine_0 restaurants .',
        '... contains ( cuisines , GENERIC_ENTITY_com.yelp:restaurant_cuisine_0 ) ;'
    ],
];

const CONTEXTUAL_TEST_CASES_NEW = [
    [
        '... filter food =~ QUOTED_STRING_0 ... ;',
        'yes , how about a chinese restaurant ?',
        '... filter food =~ " chinese " ...',
        'yes , how about a QUOTED_STRING_1 restaurant ?',
        '... filter food =~ QUOTED_STRING_1 ...'
    ],

    [
        '... filter food =~ QUOTED_STRING_0 ... ;',
        'yes , how about that ?',
        '... filter food =~ QUOTED_STRING_0 ...',
        'yes , how about that ?',
        '... filter food =~ QUOTED_STRING_0 ...'
    ],


    [
        '... filter departure =~ QUOTED_STRING_1 && destination =~ QUOTED_STRING_0 ... arrive_by = TIME_0 , leave_at = TIME_1 ...',
        'i would like to arrive in cambridge by TIME_2 on wednesday .',
        '... filter arrive_by <= TIME_2 ... && departure =~ QUOTED_STRING_1 && destination =~ " cambridge " => notify ;',
        'i would like to arrive in QUOTED_STRING_2 by TIME_2 on wednesday .',
        '... filter arrive_by <= TIME_2 ... && departure =~ QUOTED_STRING_1 && destination =~ QUOTED_STRING_2 => notify ;'
    ],


    [
        '... filter departure =~ QUOTED_STRING_1 && destination =~ QUOTED_STRING_0 ... arrive_by = TIME_0 , leave_at = TIME_1 ...',
        'i would like to arrive by TIME_2 on wednesday .',
        '... filter arrive_by <= TIME_2 ... && departure =~ QUOTED_STRING_1 && destination =~ QUOTED_STRING_0 => notify ;',
        'i would like to arrive by TIME_2 on wednesday .',
        '... filter arrive_by <= TIME_2 ... && departure =~ QUOTED_STRING_1 && destination =~ QUOTED_STRING_0 => notify ;'
    ],


    [
        '... departure = QUOTED_STRING_0 , destination = QUOTED_STRING_1 , id = GENERIC_ENTITY_uk.ac.cam.multiwoz.Train:Train_0 ...',
        'what is the price of tr5695 train ?',
        '... departure =~ QUOTED_STRING_0 && destination =~ QUOTED_STRING_1 && id =~ " tr5695 " ) => notify ;',
        'what is the price of QUOTED_STRING_2 train ?',
        '... departure =~ QUOTED_STRING_0 && destination =~ QUOTED_STRING_1 && id =~ QUOTED_STRING_2 ) => notify ;'
    ],
];

const CONTEXTUAL_TEST_CASES_LEGACY = [
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
    for (let i = 0; i < SINGLE_TURN_TEST_CASES_LEGACY.length; i++) {
        let [sentence, program, expectedSentence, expectedProgram] = SINGLE_TURN_TEST_CASES_LEGACY[i];

        let [generatedSentence, generatedProgram] = requoteSentence(i, null, sentence, program,
            'replace', true, 'en-US');
        assert.strictEqual(generatedProgram, expectedProgram);
        assert.strictEqual(generatedSentence, expectedSentence);
    }

    for (let i = 0; i < SINGLE_TURN_TEST_CASES_NEW.length; i++) {
        let [sentence, program, expectedSentence, expectedProgram] = SINGLE_TURN_TEST_CASES_NEW[i];

        let [generatedSentence, generatedProgram] = requoteSentence(i, null, sentence, program,
            'replace', true, 'en-US');
        assert.strictEqual(generatedProgram, expectedProgram);
        assert.strictEqual(generatedSentence, expectedSentence);
    }
}

function testRequoteContextual() {
    for (let i = 0; i < CONTEXTUAL_TEST_CASES_LEGACY.length; i++) {
        let [context, sentence, program, expectedSentence, expectedProgram] = CONTEXTUAL_TEST_CASES_LEGACY[i];

        let [generatedSentence, generatedProgram] = requoteSentence(i, context, sentence, program,
            'replace', true, 'en-US');
        assert.strictEqual(generatedProgram, expectedProgram);
        assert.strictEqual(generatedSentence, expectedSentence);

    }

    for (let i = 0; i < CONTEXTUAL_TEST_CASES_NEW.length; i++) {
        let [context, sentence, program, expectedSentence, expectedProgram] = CONTEXTUAL_TEST_CASES_NEW[i];

        let [generatedSentence, generatedProgram] = requoteSentence(i, context, sentence, program,
            'replace', true, 'en-US');
        assert.strictEqual(generatedProgram, expectedProgram);
        assert.strictEqual(generatedSentence, expectedSentence);

    }
}


async function main() {
    testRequoteSingleTurn();
    testRequoteContextual();
}
export default main;
if (!module.parent)
    main();
