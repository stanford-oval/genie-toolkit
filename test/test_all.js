// all tests, in batch form
"use strict";

// load everything in process so we have a global view of code coverage
require('..');

process.on('unhandledRejection', (up) => { throw up; });
process.env.TEST_MODE = '1';

async function seq(array) {
    for (let fn of array) {
        console.log(`Running ${fn}`);
        await require(fn)();
    }
}

seq([
    ('./test_unit'),
    ('./auto_test_almond'),
    ('./test_helpers'),
    ('./test_entities'),
    ('./test_dialogue_state_utils')
]);
