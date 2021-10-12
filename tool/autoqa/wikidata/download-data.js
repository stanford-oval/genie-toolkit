// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as ThingTalk from 'thingtalk';
import csvstringify from 'csv-stringify';

import * as StreamUtils from '../../../lib/utils/stream-utils';
import { makeMetadata } from '../lib/metadata';
import { cleanEnumValue } from '../lib/utils';

import {
    unitConverter,
    wikidataQuery,
    getItemLabel,
    getEquivalent
} from './utils';

class Downloader {
    constructor(options) {
        this._options = options;
        // metadata for each wikidata type
        this.meta = {};
        // normalized file for single-turn
        this.output = {};
        // normalized file for dialogue
        this.database_map = {};
        this.databases = {};
    }

    async init(thingpedia) {
        const library = ThingTalk.Syntax.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
        assert(library instanceof ThingTalk.Ast.Library && library.classes.length === 1);
        const classDef = library.classes[0];
        this._classDef = classDef;

        for (let fn in classDef.queries) {
            const fndef = classDef.queries[fn];
            const fields = makeMetadata(classDef.name, fndef.args.map((argname) => fndef.getArgument(argname)));
            this.meta[fn] = {
                extends: [],
                fields: fields,
                subject: fndef.getImplementationAnnotation('wikidata_subject'),
                required_fields: fndef.getImplementationAnnotation('required_properties') || Object.keys(fields)
            };
            this.database_map[fn] = [`${classDef.name}:${fn}`, `./${fn.toLowerCase()}_db.json`];
        }
    }

    _processValue(fname, arg, value) {
        const expectedType = this.meta[fname].fields[arg];
        const id = value.value.value;
        const label = value.valueLabel.value;

        // location
        if (typeof expectedType.type === 'object' && 'latitude' in expectedType.type)
            return { latitude: null, longitude: null, display: label };

        assert.strictEqual(typeof expectedType.type, 'string');

        // domain-specific entities
        if (!expectedType.type.startsWith('tt:'))
            return { value: id, display: label };

        // enums
        if (expectedType.type.startsWith('tt:Enum(')) {
            const enumerands = expectedType.type.substring('tt:Enum('.length, expectedType.type.length - 1).split(/,/g);
            const processed = cleanEnumValue(label);
            if (!enumerands.includes(label)) {
                console.error(`Expected enumerated value ${enumerands.join(', ')} for ${arg}, got ${label}`);
                return undefined;
            }
            return processed;
        }

        // measurement
        if (expectedType.type === 'tt:Measure') {
            const unit = unitConverter(value.unitLabel.value);
            if (unit)
                return ThingTalk.Units.transformToBaseUnit(parseFloat(label), unit);
            console.error(`Unknown unit ${value.unitLabel.value}.`);
            return parseFloat(label);
        }

        // currency
        if (expectedType.type === 'tt:Currency') {
            const unit = unitConverter(value.unitLabel.value);
            if (unit)
                return { value: parseFloat(label), unit };
            console.error(`Unknown currency ${value.unitLabel.value}.`);
            return parseFloat(label);
        }

        // numbers
        if (expectedType.type === 'tt:Number')
            return parseFloat(label);

        // string, date
        return label;
    }

    _processField(fname, arg, values) {
        const expectedType = this.meta[fname].fields[arg];

        if (values.length === 0) {
            if (expectedType.isArray)
                return [];
            else
                return undefined;
        }

        if (!expectedType.isArray && values.length > 1)
            console.error(`Unexpected array for ${arg}`);

        if (expectedType.isArray)
            return values.map((v) => this._processValue(fname, arg, v));
        return this._processValue(fname, arg, values[0]);
    }

    async _downloadOne(fname, item) {
        const id = `${item.value.value.substring('http://www.wikidata.org/entity/'.length)}`;
        const data = {
            '@id': item.value.value,
            'name':await getItemLabel(id),
            '@type': fname
        };

        const fields = Object.keys(this.meta[fname].fields).filter((arg) => arg !== 'id');
        /* we have to run one field a time. if we put all fields in one query:
        (1) we have to split required/optional fields, otherwise it will return nothing if there is 1 field empty
        (2) we will get all possible combinations for each field with multiple values (which is common in wikidata) and
        end up with exponential number of results.
         */
        for (let field of fields) {
            const wikidataId = this._classDef.queries[fname].getArgument(field).getImplementationAnnotation('wikidata_id');
            let query;
            if (['tt:Measure', 'tt:Currency'].includes(this.meta[fname].fields[field].type)) {
                query = `SELECT ?value ?valueLabel ?unit ?unitLabel
                    WHERE {
                        wd:${id} p:${wikidataId}/psv:${wikidataId}
                        [ wikibase:quantityAmount ?value ; wikibase:quantityUnit ?unit ] .
                        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
                    }`;
            } else {
                query = `SELECT ?value ?valueLabel
                    WHERE {
                        wd:${id} wdt:${wikidataId} ?value.
                        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
                    }`;
            }
            const result = await wikidataQuery(query);
            if (result.length === 0)
                continue;
            data[field] = this._processField(fname, field, result);
        }
        this.databases[fname].push(data);
        this.output[fname][item.value.value] = data;
    }

    async download() {
        for (let fn in this.meta) {
            this.databases[fn] = [];
            this.output[fn] = {};
            let items;
            const triples = [];
            for (let arg of this.meta[fn].required_fields)
                triples.push(`wdt:${arg} ?${arg}`);
            const subject = this.meta[fn].subject;
            const equivalentClasses = await getEquivalent(subject);
            const classes = equivalentClasses ? [subject, ...equivalentClasses] : [subject];
            const visited = new Set();
            for (let klass of classes) {
                const predicate = klass === 'Q5' ? 'wdt:P31' : 'p:P31/ps:P31/wdt:P279*';
                const query = `
                    SELECT DISTINCT ?value
                    WHERE {
                      ?value ${predicate} wd:${klass}; ${triples.join('; ')} .
                    }
                    LIMIT ${Math.ceil(this._options.target_size / classes.length)}
                `;
                items = await wikidataQuery(query);
                for (let item of items) {
                    if (!(item.value.value in visited)) {
                        await this._downloadOne(fn, item);
                        visited.add(item.value.value);
                    }
                }
            }
        }
    }
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('wikidata-download-data', {
        add_help: true,
        description: "Download sample data from wikidata."
    });
    parser.add_argument('--output-dir', {
        required: true,
        help: 'Path to the database map.'
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--target-size', {
        required: false,
        default: 10,
        help: 'Target size to download.'
    });
    parser.add_argument('--dialogue', {
        action: 'store_true',
        required: false,
        default: false,
        help: 'Generate data for dialogue experiment or single-turn QA experiment.'
    });
}

export async function execute(args) {
    const downloader = new Downloader(args);
    await downloader.init(args.thingpedia);
    await downloader.download();

    if (args.dialogue) {
        const output = csvstringify({ header: false, delimiter: '\t' });
        output.pipe(fs.createWriteStream(path.resolve(args.output_dir, 'database-map.tsv')));
        for (let fn in downloader.database_map)
            output.write(downloader.database_map[fn]);
        output.end();
        await StreamUtils.waitFinish(output);

        for (let fn in downloader.databases) {
            const output = fs.createWriteStream(path.resolve(args.output_dir, `${downloader.database_map[fn][1]}`));
            output.end(JSON.stringify(downloader.databases[fn], undefined, 2));
            await StreamUtils.waitFinish(output);
        }
    } else {
        const output = fs.createWriteStream(path.resolve(args.output_dir, 'data.json'));
        output.end(JSON.stringify(downloader.output, undefined, 2));
        await StreamUtils.waitFinish(output);
    }
}
