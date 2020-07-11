// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// See COPYING for details
"use strict";

// all tests, in batch form

process.on('unhandledRejection', (up) => { throw up; });

process.env.TEST_MODE = '1';

// require everything, to get a complete view of code coverage
require('../../lib/index');


async function do_test(array) {
    if (typeof array !== 'undefined' && array instanceof Array ){
        for (let fn of array) {
            console.log(`Running ${fn}`);
            await require(fn)();
        }
    }
}


// test lib scripts
do_test([
    ('./test_array_set'),
    ('./test_augment'),
    ('./test_base_canonical_generator'),
    ('./test_engine_protocol'),
    ('./test_entities'),
    ('./test_helpers'),
    ('./test_i18n_chinese'),
    ('./test_ip_address'),
    ('./test_linked_list'),
    ('./test_misc'),
    ('./test_new_tokenizer_en'),
    ('./test_new_tokenizer_it'),
    ('./test_new_tokenizer_zh'),
    ('./test_priority_queue'),
    ('./test_random'),
    ('./test_requoting'),
    ('./test_sentence_generator'),
    ('./test_stream_utils'),
    ('./test_timed_reference'),
    ('./test_timers'),
    ('./test_wikidata_utils'),
]);
