// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

module.exports = class TripleStore {
    get uri() {
        throw new Error('Not Implemented');
    }

    ref() {}

    unref() {}

    get(patterns) {
        throw new Error('Not Implemented');
    }

    getOne(patterns) {
        return Q.Promise((callback, errback) => {
            var stream = this.get(patterns);
            stream.on('error', errback);
            var done = false;
            stream.on('data', (data) => {
                if (!done) {
                    callback(data);
                    done = true;
                }
            });
            stream.on('end', () => {
                if (!done) {
                    callback();
                    done = true;
                }
            });
        });
    }

    put() {
        throw new Error('Operation Not Permitted');
    }

    del() {
        throw new Error('Operation Not Permitted');
    }

    delAll(triples) {
        throw new Error('Operation Not Permitted');
    }
}
