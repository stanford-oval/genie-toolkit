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
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import assert from 'assert';
import * as util from 'util';
import * as path from 'path';
import * as os from 'os';
import * as I18N from '../../../lib/i18n';
import JSONStream from 'JSONStream';
import {
    getType,
    getElementType,
    argnameFromLabel,
    loadSchemaOrgManifest
} from './utils';

const INSTANCE_OF_PROP = "P31";

class ParamDatasetGenerator {
    constructor(options) {
        this._locale = options.locale;
        this._domain = options.domain;
        this._canonical = options.canonical;
        this._input_dir = options.inputDir;
        this._output_dir = options.outputDir;
        this._maxValueLength = options.maxValueLength;
        this._tokenizer = I18N.get(options.locale).getTokenizer();
        this._schemaorgManifest = options.schemaorgManifest;
        this._schemaorgProperties = {};
        this._properties = {};
        this._instances = new Set();
        this._property_item_map_path = path.join(this._output_dir, this._canonical, 'property_item_map.json');
        this._instance_file_path = path.join(this._output_dir, this._canonical, 'instances.txt');
        this._property_value_map_path = path.join(this._output_dir, this._canonical, 'property_item_values.json');
        this._instance_value_map_path = path.join(this._output_dir, this._canonical, 'instance_item_values.json');
        this._parameterDatasetManifest = new Map();
    }

    async _readSync(func, dir) {
        return util.promisify(func)(dir, { encoding: 'utf8' });
    }

    async _outputEntityValueSet(type, data) {
        const outputPath = path.join(this._output_dir, this._canonical, 'parameter-datasets', `${type}.json`);
        const manifestEntry = `entity\t${this._locale}\t${type}\tparameter-datasets/${type}.json`;
        if (this._parameterDatasetManifest.has(type)) {
            const savedData = JSON.parse(await this. _readSync(fs.readFile, outputPath));
            // Just keep unique values
            data = Array.from(new Set(savedData['data'].concat(data)));
        } 
        await util.promisify(fs.writeFile)(outputPath, JSON.stringify({ result: 'ok', data }, undefined, 2), { encoding: 'utf8' });
        this._parameterDatasetManifest.set(type, manifestEntry);
    }

    async _outputStringValueSet(type, data) {
        const outputPath = path.join(this._output_dir, this._canonical, 'parameter-datasets', `${type}.tsv`);
        const manifestEntry = `string\t${this._locale}\t${type}\tparameter-datasets/${type}.tsv`;
        data = data.join(os.EOL).concat(os.EOL);
        await util.promisify(fs.appendFile)(outputPath, data, { encoding: 'utf8' });
        this._parameterDatasetManifest.set(type, manifestEntry);
    }

    async _outputDomainValueSet() {
        const instanceValueMap = JSON.parse(await this._readSync(fs.readFile, this._instance_value_map_path));
        const instanceQids = new Set((await this._readSync(fs.readFile, this._instance_file_path)).split(','));
        const data = [];
        for (const id of instanceQids) {
            const name = instanceValueMap[id];
            if (name) {
                const canonical = this._tokenizer.tokenize(name).tokens.join(' ');
                data.push({ value: id, name, canonical });
            }
        }
        await this._outputEntityValueSet(`org.wikidata:${this._canonical}`, data);
    }

    /**
     * Generates paramter-datasets. Iterate through each domain properties.
     * Find data type and value and output corresponding json/tsv files.
     */
    async _processData(canonical) {
        const domainProperties = JSON.parse(await this. _readSync(fs.readFile, this._property_item_map_path));
        const propertyLabels = JSON.parse(await this. _readSync(fs.readFile, 'filtered_property_wikidata4.json'));
        const itemLabels = JSON.parse(await this. _readSync(fs.readFile, this._property_value_map_path));
        const filteredDomainProperties = [];

        console.log('Processing entity: ', this._canonical);
        this._outputDomainValueSet();
        
        for (const [property, qids] of Object.entries(domainProperties)) {
            // Ignore list for now as later step throws error
            if (['P2439'].indexOf(property) > -1)
                continue;
            const label = propertyLabels[property];
            console.log('Processing property: ', label);
            let type = await getType(canonical, property, label, this._schemaorgProperties);
            let fileId = `org.wikidata:${(await argnameFromLabel(label))}`;
            let isEntity = false;

            type = getElementType(type);
            if (type.isEntity) {
                const typeStr = type.toString();
                fileId = `${typeStr.substring(typeStr.lastIndexOf("Entity(") + 7, typeStr.indexOf(")"))}`;
                isEntity = true;
            }  else if (type.isLocation) {
                fileId = 'tt:location';
                isEntity = true;
            }  else if (type.isCurrency) {
                fileId = 'tt:currency_code';
                isEntity = true;
            } else if (type.isString) {
                isEntity = false;
            } else { // Enum, Date, Measure, Number
                filteredDomainProperties.push(property);
                continue;
            }

            const data = [];
            for (const qid of qids) {
                // Tokenizer throws error.
                if (itemLabels[qid].includes('æ'))
                    continue;
                // tsv record length get's messed up and constants sampler throws error.
                if (type.isString && itemLabels[qid].startsWith('"'))
                    continue;

                const tokens = this._tokenizer.tokenize(itemLabels[qid]).tokens;
                // if some tokens are uppercase, they are entities, like NUMBER_0,
                // in which case we ignore this value
                if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                    continue;

                const tokenizedString = tokens.join(' ');    
                if (this._maxValueLength && 
                    this._maxValueLength >= 0 && 
                    tokenizedString.length > this._maxValueLength)
                    continue;

                if (isEntity) {
                    data.push({
                        'value': itemLabels[qid],
                        'name': qid,
                        'canonical': tokenizedString
                    });
                } else {
                    const weight = 1;
                    data.push(`${itemLabels[qid]}\t${tokenizedString}\t${weight}`);
                }
            }

            // Ignore if the property finds no valid value.
            if (data.length !== 0) {
                filteredDomainProperties.push(property);
                if (isEntity) 
                    this._outputEntityValueSet(fileId, data);
                else 
                    this._outputStringValueSet(fileId, data);
            }
        }
        await Promise.all([
            util.promisify(fs.writeFile)(path.join(this._output_dir, this._canonical, 'parameter-datasets.tsv'),
                Array.from(this._parameterDatasetManifest.values()).join('\n'), { encoding: 'utf8' }),
            util.promisify(fs.writeFile)(path.join(this._output_dir, this._canonical, 'properties.txt'), 
                filteredDomainProperties.join(','), { encoding: 'utf8' })
        ]);    
        console.log(`${filteredDomainProperties.length} filtered properties in domain.`);  
    }

    /**
     * Iterate through items in property_item_map.json and map each item as { qid: label } (property_item_values.json).
     * Also iterate through the domain instances and map each item as { qid: label } (instance_item_values.json).
     */
    async _filterItemValues(canonical) {
        if (!fs.existsSync(this._property_item_map_path) || !fs.existsSync(this._instance_file_path)) 
            throw Error('Required file(s) missing.');

        console.log(`Processing items_wikidata_n.json`);
        const properties = JSON.parse(await this. _readSync(fs.readFile, this._property_item_map_path));
        const instanceQids = new Set((await this. _readSync(fs.readFile, this._instance_file_path)).split(','));
        const propertyValues = {};
        const instanceValues = {};

        let propertyQids = [];
        // Get list of entities to find labels.
        for (const qids of Object.values(properties)) 
            propertyQids = propertyQids.concat(qids);
        propertyQids = new Set(propertyQids);

        const pipeline = fs.createReadStream(path.join(this._input_dir, `items_wikidata_n.json`)).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (data) => {
            const key = String(data.key);
            const value = String(data.value);

            if (instanceQids.has(key))
                instanceValues[key] = value;

            if (propertyQids.has(key))
                propertyValues[key] = value;
        });

        pipeline.on('error', (error) => console.error(error));
        pipeline.on('end', async () => {
            console.log(`Found ${Object.keys(propertyValues).length} items in domain property.`);
            await Promise.all([
                util.promisify(fs.writeFile)(this._property_value_map_path, 
                    JSON.stringify(propertyValues), { encoding: 'utf8' }),
                util.promisify(fs.writeFile)(this._instance_value_map_path, 
                    JSON.stringify(instanceValues), { encoding: 'utf8' })    
            ]);
            await this._processData(canonical);
        });
    }

    /**
     * Stream through CSQA { object: { pid: subject } json (comp_wikidata_rev.json). Check if the object is instance of the domain. 
     * Appends the predicates and their subject as { pid: [subject qids] } to property_item_map.json.
     */
    async _mapDomainRevProperties(canonical) {
        if (!fs.existsSync(this._property_item_map_path) || !fs.existsSync(this._instance_file_path)) 
            throw Error('Required file(s) missing.');

        console.log('Processing comp_wikidata_rev.json');
        const properties = JSON.parse(await this. _readSync(fs.readFile, this._property_item_map_path));
        const instanceQids = new Set((await this. _readSync(fs.readFile, this._instance_file_path)).split(','));        
        const filteredProperties = JSON.parse(await this. _readSync(fs.readFile, 'filtered_property_wikidata4.json'));
        const pipeline = fs.createReadStream(path.join(this._input_dir, `comp_wikidata_rev.json`)).pipe(JSONStream.parse('$*'));

        pipeline.on('data', async (data) => {
            if (instanceQids.has(data.key)) {
                for (const [key, value] of Object.entries(data.value)) {
                    if (key in filteredProperties) {
                        if (!(key in properties))
                            properties[key] = [];

                        properties[key] = Array.from(new Set(properties[key].concat(value)));
                    }
                }
            }
        });

        pipeline.on('error', (error) => console.error(error));
        pipeline.on('end', async () => {
            console.log(`Found ${instanceQids.size} instances in ${canonical} domain with ${Object.keys(properties).length} properties.`);
            await util.promisify(fs.writeFile)(this._property_item_map_path, JSON.stringify(properties), { encoding: 'utf8' });
            await this._filterItemValues(canonical);
        });
    }

    /**
     * Stream through CSQA { subject: { pid: object } json (wikidata_short_[1|2].json).
     * Find an entity that is instance of the domain and output as comma separated string (instances.txt).
     * Collects the predicates and their object as { pid: [object qids] } map (property_item_map.json).
     */
    async _mapDomainProperties(domain, canonical, idx, mapReverse) {
        console.log(`Processing wikidata_short_${idx + 1}.json`);
        const filteredProperties = JSON.parse(await this. _readSync(fs.readFile, 'filtered_property_wikidata4.json'));
        const pipeline = fs.createReadStream(path.join(this._input_dir, `wikidata_short_${idx + 1}.json`)).pipe(JSONStream.parse('$*'));

        pipeline.on('data', async (data) => {
            if (INSTANCE_OF_PROP in data.value) {
                const entry = new Set(data.value[INSTANCE_OF_PROP]);
                // Find an entity that is instance of the domain.
                if (entry.has(domain)) {
                    for (const [key, value] of Object.entries(data.value)) {
                        // Check if in filtered properties map.
                        if (key in filteredProperties) {
                            if (!(key in this._properties))
                                this._properties[key] = [];
                            // Add to property as a key to property to item qid array map
                            this._properties[key] = Array.from(new Set(this._properties[key].concat(value)));
                        }
                    }
                    // Add to list of domain instances.
                    this._instances.add(String(data.key));
                }
            }
        });

        pipeline.on('error', (error) => console.error(error));
        pipeline.on('end', async () => {
            // Stream another wikidata file if there is any left
            if (idx !== 0) {
               await this._mapDomainProperties(domain, canonical, idx - 1, mapReverse);
            } else {
                console.log(`Found ${this._instances.size} instances in ${canonical} domain with ${Object.keys(this._properties).length} properties.`);
                await Promise.all([
                    util.promisify(fs.writeFile)(this._property_item_map_path, 
                        JSON.stringify(this._properties), { encoding: 'utf8' }),
                    util.promisify(fs.writeFile)(this._instance_file_path, 
                        Array.from(this._instances).join(','), { encoding: 'utf8' })    
                ]);
                
                if (mapReverse) { // Map reverse relations as well.
                    await this._mapDomainRevProperties(canonical);
                } else {
                    await this._filterItemValues(canonical);
                }
            }
        });
    }

    async run() {
        // Required CSQA Wikidata json files
        assert(fs.existsSync('filtered_property_wikidata4.json'));

        // Set up
        const outputDir = path.join(this._output_dir, this._canonical, 'parameter-datasets');
        await util.promisify(fsExtra.emptyDir)(outputDir); // Clean up parameter-datasets
        await util.promisify(fs.mkdir)(outputDir, { recursive: true });
        await loadSchemaOrgManifest(this._schemaorgManifest, this._schemaorgProperties);

        // Process domain property map for the first time then process data.
        if (!fs.existsSync(this._property_item_map_path) || 
            !fs.existsSync(this._instance_file_path) ||
            !fs.existsSync( this._property_value_map_path) ||
            !fs.existsSync(this._instance_value_map_path)) {
            assert(fs.existsSync(path.join(this._input_dir, 'items_wikidata_n.json')));
            assert(fs.existsSync(path.join(this._input_dir, 'wikidata_short_1.json')));
            assert(fs.existsSync(path.join(this._input_dir, 'wikidata_short_2.json')));
            assert(fs.existsSync(path.join(this._input_dir, 'comp_wikidata_rev.json')));
            await this._mapDomainProperties(this._domain, this._canonical, 1, true);
        } else {
            await this._processData(this._canonical);
        }
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-preprocess-data', {
            add_help: true,
            description: "Generate parameter-datasets.tsv from processed wikidata dump. "
        });
        parser.add_argument('-o', '--output', {
            required: true,
        });
        parser.add_argument('-i', '--input', {
            required: true,
        });
        parser.add_argument('--locale', {
            required: false,
            default: 'en-US'
        });
        parser.add_argument('--domain', {
            required: true,
            help: 'athedomain (by item id) to process data'
        });
        parser.add_argument('--domain-canonical', {
            required: true,
            help: 'the canonical form for the given domain, used as the query names'
        });
        parser.add_argument('--schemaorg-manifest', {
            required: false,
            help: 'Path to manifest.tt for schema.org; used for predict the type of wikidata properties'
        });
        parser.add_argument('--max-value-length', {
            required: false,
            help: ''
        });
    },

    async execute(args) {
        const paramDatasetGenerator = new ParamDatasetGenerator({
            locale: args.locale,
            domain: args.domain,
            canonical: args.domain_canonical,
            inputDir: args.input,
            outputDir: args.output,
            schemaorgManifest:args.schemaorg_manifest,
            maxValueLength: args.max_value_length
        });
        paramDatasetGenerator.run();
    }
};