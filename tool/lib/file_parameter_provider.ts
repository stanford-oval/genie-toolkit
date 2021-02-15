// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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


import * as util from 'util';
import * as fs from 'fs';
import byline from 'byline';
import csvparse from 'csv-parse';
import * as path from 'path';

interface EntityRecord {
    type : string;
    value : string;
    canonical : string;
    name : string;
}
interface ParameterRecord {
    preprocessed : string;
    value : string;
    weight : number;
}

// Load strings and entities from files
//
// Strings are loaded from the TSV files generated from
// https://almond.stanford.edu/thingpedia/strings/download/:x
//
// Entities are loaded from the JSON files returned from
// https://almond.stanford.edu/thingpedia/api/v3/entities/list/:x

export default class FileParameterProvider {
    private _filename : string;
    private _paramLocale : string;
    private _dirname : string;
    private _paths : Map<string, string>;

    private _loaded : boolean;

    constructor(filename : string, paramLocale : string) {
        this._filename = filename;
        this._paramLocale = paramLocale || 'en-US';
        this._dirname = path.dirname(filename);
        this._paths = new Map;

        this._loaded = false;
    }

    async open() : Promise<void> {
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

        await new Promise((resolve, reject) => {
            input.on('end', resolve);
            input.on('error', reject);
        });
        this._loaded = true;
    }

    async close() : Promise<void> {
    }

    private async _getStrings(stringType : string) : Promise<ParameterRecord[]> {
        const filepath = this._paths.get('string+' + stringType);
        if (!filepath)
            return [];

        const strings : ParameterRecord[] = [];
        const input = fs.createReadStream(filepath)
            .pipe(csvparse({ delimiter: '\t', relax: true }));

        input.on('data', (line) => {
            const value = line[0];
            let preprocessed, weight;
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

        return new Promise<ParameterRecord[]>((resolve, reject) => {
            input.on('end', () => {
                if (strings.length === 0)
                    console.log('actually no values for', stringType, filepath);
                resolve(strings);
            });
            input.on('error', reject);
        });
    }

    private async _getEntities(stringType : string) : Promise<ParameterRecord[]> {
        return (await this.getEntity(stringType)).map((e) => {
            return { preprocessed: e.canonical, weight: 1.0, value:e.value, name:e.name };
        });
    }

    async getEntity(stringType : string) : Promise<EntityRecord[]> {
        if (!this._loaded)
            await this.open();
        const filepath = this._paths.get('entity+' + stringType);
        if (!filepath)
            return [];

        return JSON.parse(await util.promisify(fs.readFile)(filepath, { encoding: 'utf8' })).data;
    }

    async get(valueListType : 'string'|'entity', valueListName : string) : Promise<ParameterRecord[]> {
        if (!this._loaded)
            await this.open();
        switch (valueListType) {
        case 'string':
            return this._getStrings(valueListName);
        case 'entity':
            return this._getEntities(valueListName);
        default:
            throw new TypeError(`Unexpected value list type ${valueListType}`);
        }
    }
}
