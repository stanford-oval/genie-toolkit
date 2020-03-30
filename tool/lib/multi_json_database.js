// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const util = require('util');
const fs = require('fs');
const path = require('path');

/**
 * Parse a TSV file in a format similar to shared-parameter-datasets.tsv
 * with one line per Thingpedia query, pointing to a JSON file for each.
 */
class MultiJSONDatabase {
    constructor(filename) {
        this._filename = filename;
        this._dirname = path.dirname(filename);

        this._store = new Map;
    }

    async load() {
        const lines = (await util.promisify(fs.readFile)(this._filename, { encoding: 'utf8' })).split(/\r?\n/g);
        await Promise.all(lines.map(async (line) => {
            if (!line.trim() || line.startsWith('#'))
                return;

            let [functionKey, filepath] = line.trim().split('\t');
            filepath = path.resolve(this._dirname, filepath);

            const file = JSON.parse(await util.promisify(fs.readFile)(filepath, { encoding: 'utf8' }));
            this._store.set(functionKey, file);
        }));
    }

    get size() {
        return this._store.size;
    }
    has(key) {
        return this._store.has(key);
    }
    get(key) {
        return this._store.get(key);
    }
}
module.exports = MultiJSONDatabase;
