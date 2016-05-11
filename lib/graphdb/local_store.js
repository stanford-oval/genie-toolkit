// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const fs = require('fs');
const level = require("levelup");
const levelgraph = require("levelgraph");
const Tp = require('thingpedia');
const TripleStore = Tp.TripleStore;

module.exports = class LocalTripleStore extends TripleStore {
    constructor(path) {
        super();

        this.rdf = null;
        this._path = path;
        this._refcount = 0;
    }

    get uri() {
        return 'omlet://me';
    }

    ref() {
        this._refcount ++;
        if (this._refcount == 1)
            this._db = levelgraph(level(this._path));
    }

    unref() {
        this._refcount --;
        if (this._refcount == 0)
            this._db.close();
    }

    put(triples) {
        return Q.ninvoke(this._db, 'put', triples);
    }

    get(patterns) {
        var mapvariable = (v) => {
            if (v.startsWith('?'))
                return this._db.v(v);
            else
                return v;
        }
        patterns = patterns.map((p) => {
            var obj = {
                subject: mapvariable(p.subject),
                predicate: mapvariable(p.predicate),
                object: mapvariable(p.object)
            };
            return obj;
        })
        console.log('Search for', patterns);
        return this._db.searchStream(patterns);
    }

    del(triples) {
        return Q.ninvoke(this._db, 'del', triples);
    }

    delAll(pattern) {
        return Q.ninvoke(this._db, 'get', pattern).then((list) => {
            return Q.all(list.map((l) => Q.ninvoke(this._db, 'del', l)));
        });
    }
}
