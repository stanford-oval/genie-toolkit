// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const SparqlParser = require('sparqljs').Parser;

const SelectRunner = require('./selectrunner');

module.exports = class SparqlRunner {
    constructor(stores) {
        this._stores = stores;
        this._parser = new SparqlParser();
    }

    start() {
        return Q();
    }

    stop() {
        return Q();
    }

    runQuery(query) {
        var parsed = this._parser.parse(query);

        switch (parsed.type) {
        case 'query':
            var runner = new SelectRunner(this._stores, parsed);
            return runner.run();
        case 'update':
            throw new Error('update not implemented');
        default:
            throw new Error('Unrecognized query type ' + parsed.type);
        }
    }
}
// we don't have a way to return a Stream yet
//module.exports.prototype.$rpcMethods = ['runQuery'];
module.exports.prototype.$rpcMethods = [];
