// all tests, in batch form
"use strict";

process.on('unhandledRejection', (up) => { throw up; });

process.env.TEST_MODE = '1';

async function seq(array) {
    for (let fn of array) {
        console.log(`Running ${fn}`);
        await require(fn)();
    }
}

seq([
    ('./test_sentence_generator')
]);
