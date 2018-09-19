// all tests, in batch form
"use strict";

// load everything in process so we have a global view of code coverage
require('..');

process.on('unhandledRejection', (up) => { throw up; });
process.env.TEST_MODE = '1';

function seq(array) {
    return (function loop(i) {
        if (i === array.length)
            return Promise.resolve();
        else
            return Promise.resolve(array[i]()).then(() => loop(i+1));
    })(0);
}

seq([
    require('./test_unit'),
    require('./auto_test_almond'),
    require('./test_helpers'),
    require('./test_parser'),
    require('./test_entities')
]);
