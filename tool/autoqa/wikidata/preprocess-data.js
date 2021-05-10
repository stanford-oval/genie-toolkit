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
import JSONStream from 'JSONStream';

import * as I18N from '../../../lib/i18n';
import { argnameFromLabel, readJson, dumpMap } from './utils';
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
            filteredProperties: options.filteredProperties,
            bootlegTypes: options.bootlegTypes
        };

        // wikidata information
        this._wikidataProperties = new Map(); // labels for all properties
        this._bootlegTypes = new Map();

        // in domain information
        this._items = new Map();
        this._values = new Map();
        this._predicates = new Map();
        this._types = new Map(); // types for all entities
        this._subtypes = new Map(); 
        this._valueSets = new Map();

        this._manifest = fs.createWriteStream(this._paths.manifest);
        this._tokenizer = I18N.get(options.locale).getTokenizer();
    }

    async _outputValueSet(type, data) {
        const outputPath = path.join(this._paths.parameterDataset, `${type}.json`);
        const manifestEntry = `entity\t${this._locale}\t${type}\tparameter-datasets/${type}.json\n`;
        if (fs.existsSync(outputPath)) {
            // skip domain entities, no need to add
            if (type === `org.wikidata:${this._canonical}`)
                return;

            const savedData = await readJson(outputPath);
            // Just keep unique values
            data = Array.from(new Set(savedData.get('data').concat(data)));
        } 
        await util.promisify(fs.writeFile)(outputPath, JSON.stringify({ result: 'ok', data }, undefined, 2), { encoding: 'utf8' });
        this._manifest.write(manifestEntry);
    }

    async _outputDomainValueSet(manifest) {
        const data = [];
        for (const [value, label] of this._items) {
            const tokenized = this._tokenizer.tokenize(label).tokens.join(' ');
            data.push({ value, name: label, canonical: tokenized });
        }
        await this._outputValueSet(`org.wikidata:${this._canonical}`, data);
    }

    async _loadPredicates(kbFile) {
        const pipeline = fs.createReadStream(kbFile).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (item) => {
            const predicates = item.value;
            // skip entities with no "instance of" property
            if (!(INSTANCE_OF_PROP in predicates))
                return;
            
            // skip reading predicates for entities that do not have $domain as one of 
            // its types "instance of"
            const entityTypes = predicates[INSTANCE_OF_PROP];
            if (!entityTypes.includes(this._domain))
                return;

            // add wikidata item in the domain 
            // set QID as label as fallback, and update with labels later
            this._items.set(item.key, item.key);

            // add predicates
            for (const [property, values] of Object.entries(predicates)) {
                if (!this._wikidataProperties.has(property))
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

    async _loadWikidataTypes(kbFile) {
        const pipeline = fs.createReadStream(kbFile).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (item) => {
            const predicates = item.value;
            // skip entities with no type information
            if (!predicates[INSTANCE_OF_PROP])
                return;
            if (this._values.has(item.key))
                this._types.set(item.key, predicates[INSTANCE_OF_PROP]);
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    async _loadBootlegTypes() {
        const pipeline = fs.createReadStream(this._paths.bootlegTypes).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (item) => {
            if (this._values.has(item.key))
                this._bootlegTypes.set(item.key, item.value);
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    async _loadLabels() {
        const pipeline = fs.createReadStream(this._paths.wikidataEntities).pipe(JSONStream.parse('$*'));
        const valueTypes = new Set(Array.from(this._types.values()).flat());
        pipeline.on('data', async (entity) => {
            const qid = String(entity.key);
            const label = String(entity.value);
            if (this._items.has(qid))
                this._items.set(qid, label);
            if (this._values.has(qid) || valueTypes.has(qid)) 
                this._values.set(qid, label);
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    _addToValueSet(type, entry) {
        if (this._valueSets.has(type))
            this._valueSets.get(type).push(entry);
        else 
            this._valueSets.set(type, [entry]);
    }

    _getEntityType(qid) {
        const wikidataTypes = this._types.get(qid);
        const bootlegTypes = this._bootlegTypes.get(qid);
        if (!wikidataTypes)
            return null;
        // return the first type in bootleg
        if (bootlegTypes) {
            for (const type of bootlegTypes) {
                if (wikidataTypes.includes(type)) {
                    const entityType = this._values.get(type);
                    if (entityType)
                        return argnameFromLabel(entityType);
                }
            }
        }
        // fallback to the first wikidata type with label
        for (const type of wikidataTypes) {
            const entityType = this._values.get(type);
            if (entityType)
                return argnameFromLabel(entityType);
        }
        return null;
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

            // all properties in CSQA has entity values, skip if no value has been found
            if (values.length === 0)
                continue; 

            const propertyLabel = this._wikidataProperties.get(property);
            const thingtalkPropertyType = 'p_' + argnameFromLabel(propertyLabel);
            console.log('Processing property: ', propertyLabel);
            const thingtalkEntityTypes = new Set();
            for (const value of values) {
                 // skip entities with no type information
                if (!this._types.has(value))
                    continue;

                const valueType = this._getEntityType(value);
                const valueLabel = this._values.get(value);

                // value does not have value for "instance of" field
                if (!valueType)
                    continue;

                // Tokenizer throws error.
                if (valueLabel.includes('æ'))
                    continue;

                const tokens = this._tokenizer.tokenize(valueLabel).tokens;
                if (this._maxValueLength && tokens.length > this._maxValueLength) 
                    continue;

                const tokenized = tokens.join(' ');
                const entry = { value, name: valueLabel, canonical: tokenized };

                // add to property value set, for easier constant sampling
                this._addToValueSet(thingtalkPropertyType, entry);
                // add to entity value set, for actual augmentation in synthesis
                thingtalkEntityTypes.add(valueType);
                this._addToValueSet(valueType, entry);
            }
            this._subtypes.set(thingtalkPropertyType, Array.from(thingtalkEntityTypes));
            filteredDomainProperties.push(property);
        }
        for (const [valueType, examples] of this._valueSets) {
            const type = `org.wikidata:${valueType}`;
            await this._outputValueSet(type, examples);
        }
        await util.promisify(fs.writeFile)(this._paths.filteredProperties, filteredDomainProperties.join(','), { encoding: 'utf8' });

        this._manifest.end();
        await StreamUtils.waitFinish(this._manifest);
    }

    async run() {
        console.log('loading property labels ...');
        this._wikidataProperties = await readJson(this._paths.wikidataProperties);
        
        const preprocessed = ['predicates.json', 'items.json', 'values.json', 'types.json'];
        if (preprocessed.every((fname) => fs.existsSync(path.join(this._paths.dir, fname)))) {
            console.log('loading preprocessed in-domain files ...');
            this._items = await readJson(path.join(this._paths.dir, 'items.json'));
            this._predicates = await readJson(path.join(this._paths.dir, 'predicates.json'));
            this._values = await readJson(path.join(this._paths.dir, 'values.json'));
            this._types = await readJson(path.join(this._paths.dir, 'types.json'));
        } else {
            console.log('loading predicates ...');
            for (const kbfile of this._paths.wikidata)
                await this._loadPredicates(kbfile);
            console.log('loading value types ...');
            for (const kbfile of this._paths.wikidata)
                await this._loadWikidataTypes(kbfile);
            console.log('loading entity labels ...');
            await this._loadLabels();
            await dumpMap(path.join(this._paths.dir, 'items.json'), this._items);
            await dumpMap(path.join(this._paths.dir, 'predicates.json'), this._predicates);
            await dumpMap(path.join(this._paths.dir, 'values.json'), this._values);
            await dumpMap(path.join(this._paths.dir, 'types.json'), this._types);
        }

        if (this._paths.bootlegTypes) {
            console.log('loading bootleg types ...');
            await this._loadBootlegTypes();
        }

        console.log('generating parameter datasets ...');
        await this._generateParameterDatasets();
        await dumpMap(path.join(this._paths.dir, 'subtypes.json'), this._subtypes);
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
            help: "Path to output a txt file containing properties available for the domain, split by comma"
        });
        parser.add_argument('--bootleg-types', {
            required: false,
            help: "Path to types used for each entity in Bootleg"
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
            bootlegTypes: args.bootleg_types,
            maxValueLength: args.max_value_length,
            manifest: args.manifest,
            outputDir: args.output_dir
        });
        paramDatasetGenerator.run();
    }
};