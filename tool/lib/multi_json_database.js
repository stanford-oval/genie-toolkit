// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
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
