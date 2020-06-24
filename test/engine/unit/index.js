"use strict";

process.on('unhandledRejection', (up) => { throw up; });
process.env.TEST_MODE = '1';

async function seq(array) {
    for (let fn of array) {
        console.log(`Running tests for ${fn}`);
        await require(fn)();
    }
}

seq([
    ('./test_timers'),
    ('./test_util'),
    ('./test_array_set'),
    ('./test_linked_list'),
    ('./test_timed_reference'),
    ('./test_protocol')
]);
