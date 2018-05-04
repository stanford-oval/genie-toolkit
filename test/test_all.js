// all tests, in batch form
"use strict";

Promise.resolve(require('./auto_test_almond')()).then(() => {;
    return require('./test_helpers')();
});