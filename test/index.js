// all tests, in batch form
"use strict";

process.on('unhandledRejection', (up) => { throw up; });

process.env.TEST_MODE = '1';

// require everything, to get a complete view of code coverage
require('../lib/index');

async function seq(array) {
    for (let fn of array) {
        console.log(`Running ${fn}`);
        await require(fn)();
    }
}

seq([
    ('./test_stream_utils'),
    ('./test_sentence_generator'),
]);
