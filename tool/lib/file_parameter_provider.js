// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const util = require('util');
const fs = require('fs');
const byline = require('byline');
const csvparse = require('csv-parse');
const path = require('path');

// Load strings and entities from files
//
// Strings are loaded from the TSV files generated from
// https://almond.stanford.edu/thingpedia/strings/download/:x
//
// Entities are loaded from the JSON files returned from
// https://almond.stanford.edu/thingpedia/api/v3/entities/list/:x

module.exports = class FileParameterProvider {
    constructor(filename, param_locale) {
        this._filename = filename;
        this._paramLocale = param_locale || 'en-US';
        this._dirname = path.dirname(filename);
        this._paths = new Map;
    }

    async open() {
        const file = fs.createReadStream(this._filename);
        file.setEncoding('utf8');

        const input = byline(file);

        input.on('data', (line) => {
            if (/^\s*(#|$)/.test(line))
                return;

            const [stringOrEntity, locale, type, filepath] = line.trim().split('\t');
            if (stringOrEntity !== 'string' && stringOrEntity !== 'entity')
                throw new Error(`Invalid syntax: ${line}`);
            if (locale === this._paramLocale)
                this._paths.set(stringOrEntity + '+' + type, path.resolve(this._dirname, filepath));
        });

        return new Promise((resolve, reject) => {
            input.on('end', resolve);
            input.on('error', reject);
        });
    }

    async close() {
    }

    async _getStrings(stringType) {
        const filepath = this._paths.get('string+' + stringType);
        if (!filepath)
            return [];

        const strings = [];
        const input = fs.createReadStream(filepath)
            .pipe(csvparse({ delimiter: '\t', relax: true }));

        input.on('data', (line) => {
            let value, preprocessed, weight;
            value = line[0];
            if (line.length === 1) {
                preprocessed = line[0];
                weight = 1.0;
            } else if (line.length === 2) {
                if (isFinite(+line[1])) {
                    preprocessed = line[0];
                    weight = line[1];
                } else {
                    preprocessed = line[1];
                    weight = 1.0;
                }
            } else {
                preprocessed = line[1];
                weight = parseFloat(line[2]) || 1.0;
            }
            if (!(weight > 0.0))
                weight = 1.0;

            strings.push({ value, preprocessed, weight });
        });

        return new Promise((resolve, reject) => {
            input.on('end', () => {
                if (strings.length === 0)
                    console.log('actually no values for', stringType, filepath);
                resolve(strings);
            });
            input.on('error', reject);
        });
    }

    async _getEntities(stringType) {
        const filepath = this._paths.get('entity+' + stringType);
        if (!filepath)
            return [];

        const parsed = JSON.parse(await util.promisify(fs.readFile)(filepath));
        return parsed.data.map((e) => {
            return { preprocessed: e.canonical, weight: 1.0, value:e.value, name:e.name };
        });
    }

    get(valueListType, valueListName) {
        switch (valueListType) {
        case 'string':
            return this._getStrings(valueListName);
        case 'entity':
            return this._getEntities(valueListName);
        default:
            throw new TypeError(`Unexpected value list type ${valueListType}`);
        }
    }
};
