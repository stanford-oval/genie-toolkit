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
require('../lib/index');


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
    // ('./test_stream_utils'),
    // ('./test_requoting'),
    // ('./test_sentence_generator'),
    //('./test_augment'),
    ('./test_i18n_chinese'),
    ('./test_random'),
    ('./test_tokenizer')
]);
