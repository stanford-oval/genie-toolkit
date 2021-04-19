// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Naoki Yamamura <yamamura@cs.stanford.edu>
//         Silei Xu <silei@cs.stanford.edu>

import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';
import csvstringify from 'csv-stringify';
import * as I18N from '../../../lib/i18n';
import JSONStream from 'JSONStream';

import {
    getType,
    getElementType,
    argnameFromLabel,
    loadSchemaOrgManifest
} from './utils';
import * as StreamUtils from '../../../lib/utils/stream-utils';

const INSTANCE_OF_PROP = "P31";

class ParamDatasetGenerator {
    constructor(options) {
        this._locale = options.locale;
        this._domain = options.domain;
        this._canonical = options.canonical;

        this._paths = {
            dir: path.dirname(options.manifest),
            manifest: options.manifest,
            parameterDataset: options.outputDir,
            wikidata: options.wikidata,
            wikidataEntities: options.wikidataEntities,
            wikidataProperties: options.wikidataProperties,
            filteredProperties: options.filteredProperties
        };
        this._wikidataProperties = new Map();
        this._schemaorgProperties = {};

        this._items = new Map();
        this._values = new Map();
        this._predicates = new Map();

        this._manifest = fs.createWriteStream(this._paths.manifest);
        this._tokenizer = I18N.get(options.locale).getTokenizer();
    }

    async _readJson(file) {
        const data = await util.promisify(fs.readFile)(file, { encoding: 'utf8' });
        return new Map(Object.entries(JSON.parse(data)));
    }

    async _dumpMap(file, map) {
        const data = Object.fromEntries(map);
        await util.promisify(fs.writeFile)(file, JSON.stringify(data, undefined, 2));
    }

    async _outputEntityValueSet(type, data) {
        const outputPath = path.join(this._paths.parameterDataset, `${type}.json`);
        const manifestEntry = `entity\t${this._locale}\t${type}\tparameter-datasets/${type}.json\n`;
        if (fs.existsSync(outputPath)) {
            // skip domain entities, no need to add
            if (type === `org.wikidata:${this._canonical}`)
                return;

            const savedData = await this._readJson(outputPath);
            // Just keep unique values
            data = Array.from(new Set(savedData.get('data').concat(data)));
        } 
        await util.promisify(fs.writeFile)(outputPath, JSON.stringify({ result: 'ok', data }, undefined, 2), { encoding: 'utf8' });
        this._manifest.write(manifestEntry);
    }

    async _outputStringValueSet(type, data) {
        const outputPath = path.join(this._paths.parameterDataset, `${type}.tsv`);
        const output = csvstringify({ header: false, delimiter: '\t'});
        output.pipe(fs.createWriteStream(outputPath, { encoding: 'utf8' }));
        const manifestEntry = `string\t${this._locale}\t${type}\tparameter-datasets/${type}.tsv\n`;
        for (const row of data)
            output.write(row);
        StreamUtils.waitFinish(output);
        this._manifest.write(manifestEntry);
    }

    async _outputDomainValueSet(manifest) {
        const data = [];
        for (const [value, label] of this._items) {
            const tokenized = this._tokenizer.tokenize(label).tokens.join(' ');
            data.push({ value, name: label, canonical: tokenized });
        }
        await this._outputEntityValueSet(`org.wikidata:${this._canonical}`, data);
    }

    async _loadPredicates(kbFile) {
        const wikidataProperties = await this._readJson(this._paths.wikidataProperties);
        const pipeline = fs.createReadStream(kbFile).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (item) => {
            const predicates = item.value;
            // skip entities with no "instance of" property
            if (!(INSTANCE_OF_PROP in predicates))
                return;
            
            // skip entities that do not have $domain as one of its types "instance of"
            const entityTypes = predicates[INSTANCE_OF_PROP];
            if (!entityTypes.includes(this._domain))
                return;

            // add wikidata item in the domain 
            // set QID as label as fallback, and update with labels later
            this._items.set(item.key, item.key);

            // add predicates
            for (const [property, values] of Object.entries(predicates)) {
                // FIXME: is this necessary? 
                if (!wikidataProperties.has(property))
                    continue;
                if (!this._predicates.has(property))
                    this._predicates.set(property, []);

                const predicate = this._predicates.get(property);
                for (const value of values) {
                    predicate.push(value);
                    // add values 
                    // set QID as label as fallback, and update with labels later
                    this._values.set(value, value);
                }
            }
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    async _loadLabels() {
        const pipeline = fs.createReadStream(this._paths.wikidataEntities).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (entity) => {
            const qid = String(entity.key);
            const label = String(entity.value);
            if (this._items.has(qid))
                this._items.set(qid, label);
            if (this._values.has(qid)) 
                this._values.set(qid, label);
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    /**
     * Generates paramter-datasets. Iterate through each domain properties.
     * Find data type and value and output corresponding json/tsv files.
     */
    async _generateParameterDatasets() {
        console.log('Processing entity: ', this._canonical);
        this._outputDomainValueSet();

        const filteredDomainProperties = [];
        for (const [property, values] of this._predicates.entries()) {
            // Ignore list for now as later step throws error 
            // FIXME: what is this?
            if (['P2439'].indexOf(property) > -1)
                continue;

            const propertyLabel = this._wikidataProperties.get(property);
            
            console.log('Processing property: ', propertyLabel);
            let type = await getType(this._canonical, property, propertyLabel, this._schemaorgProperties);
            let fileId = `org.wikidata:${argnameFromLabel(propertyLabel)}`;
            let isEntity = false;

            type = getElementType(type);
            if (type.isEntity) {
                const typeStr = type.toString();
                fileId = `${typeStr.substring(typeStr.lastIndexOf("Entity(") + 7, typeStr.indexOf(")"))}`;
                isEntity = true;
            }  else if (type.isString) {
                isEntity = false;
            } else { // Enum, Date, Measure, Number, Location, Currency
                filteredDomainProperties.push(property);
                continue;
            }

            // skip non-wikidata-specific values
            if (!fileId.startsWith('org.wikidata:'))
                continue;

            const dataset = [];
            for (const value of values) {
                const valueLabel = this._values.get(value);

                // Tokenizer throws error.
                if (valueLabel.includes('æ'))
                    continue;
                // tsv record length get's messed up and constants sampler throws error.
                if (type.isString && valueLabel.startsWith('"'))
                    continue;

                const tokens = this._tokenizer.tokenize(valueLabel).tokens;
                if (this._maxValueLength && tokens.length > this._maxValueLength) 
                    continue;

                const tokenized = tokens.join(' ');
                if (isEntity)
                    dataset.push({ value, name: valueLabel, canonical: tokenized });
                else 
                    dataset.push([valueLabel, tokenized, 1]);
            }

            // Ignore if the property finds no valid value.
            if (dataset.length !== 0) {
                filteredDomainProperties.push(property);
                if (isEntity) 
                    this._outputEntityValueSet(fileId, dataset);
                else 
                    this._outputStringValueSet(fileId, dataset);
            }
        }
        await util.promisify(fs.writeFile)(this._paths.filteredProperties, filteredDomainProperties.join(','), { encoding: 'utf8' });

        this._manifest.end();
        await StreamUtils.waitFinish(this._manifest);
    }

    async run() {
        // load wikidata properties 
        this._wikidataProperties = await this._readJson(this._paths.wikidataProperties);
        // load schema.org manifest (to help determine property type)
        await loadSchemaOrgManifest(this._schemaorgManifest, this._schemaorgProperties);
        
        if (['predicates.json', 'items.json', 'values.json', 'properties.txt'].every((fname) => fs.existsSync(path.join(this._paths.dir, fname)))) {
            console.log('load predicates & labels from preprocessed files');
            this._items = await this._readJson(path.join(this._paths.dir, 'items.json'));
            this._predicates = await this._readJson(path.join(this._paths.dir, 'predicates.json'));
            this._values = await this._readJson(path.join(this._paths.dir, 'values.json'));
        } else {
            console.log('load predicates & labels from wikidata kb files');
            for (const kbfile of this._paths.wikidata)
                await this._loadPredicates(kbfile);
            await this._loadLabels();
            await this._dumpMap(path.join(this._paths.dir, 'items.json'), this._items);
            await this._dumpMap(path.join(this._paths.dir, 'predicates.json'), this._predicates);
            await this._dumpMap(path.join(this._paths.dir, 'values.json'), this._values);
        }
        
        // generate parameter datasets
        await this._generateParameterDatasets();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-preprocess-data', {
            add_help: true,
            description: "Generate parameter-datasets.tsv from processed wikidata dump. "
        });
        parser.add_argument('--locale', {
            required: false,
            default: 'en-US'
        });
        parser.add_argument('--domain', {
            required: true,
            help: 'the domain (by item id) to process data'
        });
        parser.add_argument('--domain-canonical', {
            required: true,
            help: 'the canonical form for the given domain, used as the query names'
        });
        parser.add_argument('--wikidata', {
            required: false,
            nargs: '+',
            help: "full knowledge base of wikidata, named wikidata_short_1.json and wikidata_short_2.json"
        });
        parser.add_argument('--wikidata-entity-list', {
            required: false,
            help: "full list of entities in the wikidata dump, named items_wikidata_n.json in CSQA," + 
                "in the form of a dictionary with QID as keys and canonical as values."
        });
        parser.add_argument('--wikidata-property-list', {
            required: true,
            help: "full list of properties in the wikidata dump, named filtered_property_wikidata4.json"
                + "in CSQA, in the form of a dictionary with PID as keys and canonical as values."
        });
        parser.add_argument('--filtered-properties', {
            required: true,
            help: "Path to a txt file containing properties available for the domain, split by comma"
        });
        parser.add_argument('--schemaorg-manifest', {
            required: false,
            help: 'Path to manifest.tt for schema.org; used for predict the type of wikidata properties'
        });
        parser.add_argument('--max-value-length', {
            required: false,
            help: 'Maximum number of tokens for parameter values'
        });
        parser.add_argument('--manifest', {
            required: true,
            help: 'Path to the parameter dataset manifest'
        });
        parser.add_argument('-d', '--output-dir', {
            required: true,
            help: 'Path to the directory for all in-domain parameter dataset files'
        });
    },

    async execute(args) {
        const paramDatasetGenerator = new ParamDatasetGenerator({
            locale: args.locale,
            domain: args.domain,
            canonical: args.domain_canonical,
            wikidata: args.wikidata,
            wikidataEntities: args.wikidata_entity_list,
            wikidataProperties: args.wikidata_property_list,
            filteredProperties: args.filtered_properties,
            schemaorgManifest:args.schemaorg_manifest,
            maxValueLength: args.max_value_length,
            manifest: args.manifest,
            outputDir: args.output_dir
        });
        paramDatasetGenerator.run();
    }
};