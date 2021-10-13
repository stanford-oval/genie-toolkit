// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as argparse from 'argparse';
import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';
import csvstringify from 'csv-stringify';
import JSONStream from 'JSONStream';

import * as I18N from '../../../lib/i18n';
import { argnameFromLabel, readJson, dumpMap, Domains } from './utils';
import * as StreamUtils from '../../../lib/utils/stream-utils';

const INSTANCE_OF_PROP = "P31";
const SYMMETRIC_PROPERTY_MIN_EXAMPLES = 10;
const SYMMETRIC_PROPERTY_THRESHOLD = 0.85;

interface EntityParameterData {
    value : string,
    name : string,
    canonical : string
}

interface ParameterDatasetGeneratorOptions {
    locale : string,
    domains : Domains,
    typeSystem : 'entity-plain' | 'entity-hierarchical' | 'string',
    wikidata : string,
    wikidataEntities : string,
    wikidataProperties : string,
    subtypes : string,
    filteredProperties : string,
    symmetricProperties : string,
    bootlegTypes : string,
    bootlegTypeCanonical : string,
    maxValueLength : number,
    manifest : string,
    outputDir : string
}

class ParamDatasetGenerator {
    private _locale : string;
    private _domains : Domains;
    private _typeSystem : string;
    private _maxValueLength : number;
    private _paths : Record<string, string>;
    private _wikidataProperties : Map<string, string>;
    private _bootlegTypes : Map<string, string[]>;
    private _items : Map<string, Map<string, string>>;
    private _predicates : Map<string, Map<string, string[]>>;
    private _values : Map<string, string>;
    private _types : Map<string, string>;
    private _subtypes : Map<string, string[]>;
    private _filteredPropertiesByDomain : Map<string, string[]>;
    private _thingtalkEntityTypes : Map<string, string>;
    private _valueSets : Map<string, Array<string[]|EntityParameterData>>;
    private _manifest : NodeJS.WritableStream;
    private _tokenizer : I18N.BaseTokenizer;

    constructor(options : ParameterDatasetGeneratorOptions) {
        this._locale = options.locale;
        this._domains = options.domains;
        this._typeSystem = options.typeSystem;
        this._maxValueLength = options.maxValueLength;

        this._paths = {
            dir: path.dirname(options.manifest),
            manifest: options.manifest,
            parameterDataset: options.outputDir,
            wikidata: options.wikidata,
            wikidataEntities: options.wikidataEntities,
            wikidataProperties: options.wikidataProperties,
            subtypes: options.subtypes,
            filteredProperties: options.filteredProperties,
            symmetricProperties: options.symmetricProperties,
            bootlegTypes: options.bootlegTypes,
            bootlegTypeCanonical: options.bootlegTypeCanonical
        };

        // wikidata information
        this._wikidataProperties = new Map(); // labels for all properties
        this._bootlegTypes = new Map();


        // in domain information
        this._items = new Map(); // items (subjects) by domain
        this._predicates = new Map(); // predicates by domain
        this._values = new Map(); // all values appeared in all domains' predicates 
        this._types = new Map(); // types for all entities
        this._subtypes = new Map();  // subtype information for all types
        this._filteredPropertiesByDomain = new Map(); // final list of properties by domain

        this._thingtalkEntityTypes = new Map(); // final thingtalk types of all values

        this._valueSets = new Map(); // parameter value sets by type 
        this._manifest = fs.createWriteStream(this._paths.manifest);
        this._tokenizer = I18N.get(options.locale).getTokenizer();

        // init items, predicates, properties
        for (const domain of this._domains.domains) {
            this._items.set(domain, new Map());
            this._predicates.set(domain, new Map());
            this._filteredPropertiesByDomain.set(domain, []);
        }
    }

    private async _outputEntityValueSet(type : string, data : EntityParameterData[]) {
        const outputPath = path.join(this._paths.parameterDataset, `${type}.json`);
        const manifestEntry = `entity\t${this._locale}\t${type}\tparameter-datasets/${type}.json\n`;
        if (fs.existsSync(outputPath)) {
            // skip domain entities, no need to add
            if (this._domains.domains.map((d) => `org.wikidata:${d}`).includes(type))
                return;

            const savedData = await readJson(outputPath);
            // Just keep unique values
            data = Array.from(new Set(savedData.get('data').concat(data)));
        } 
        await util.promisify(fs.writeFile)(outputPath, JSON.stringify({ result: 'ok', data }, undefined, 2), { encoding: 'utf8' });
        this._manifest.write(manifestEntry);
    }

    private async _outputStringValueSet(type : string, data : string[][]) {
        const outputPath = path.join(this._paths.parameterDataset, `${type}.tsv`);
        const output = csvstringify({ header: false, delimiter: '\t' });
        output.pipe(fs.createWriteStream(outputPath, { encoding: 'utf8' }));
        const manifestEntry = `string\t${this._locale}\t${type}\tparameter-datasets/${type}.tsv\n`;
        for (const row of data)
            output.write(row);
        StreamUtils.waitFinish(output);
        this._manifest.write(manifestEntry);
    }

    private async _loadPredicates() {
        // loading predicates from kb files
        for (const kbFile of this._paths.wikidata) {
            const pipeline = fs.createReadStream(kbFile).pipe(JSONStream.parse('$*'));
            pipeline.on('data', async (item) => {
                const predicates : Record<string, string[]> = item.value;
                // skip entities with no "instance of" property
                if (!(INSTANCE_OF_PROP in predicates))
                    return;
                
                // skip reading predicates for entities that do not have one of the 
                // in-domain wikidata types as its types "instance of"
                const entityTypes = predicates[INSTANCE_OF_PROP];
                let match = false;
                for (const domain of this._domains.wikidataTypes) {
                    if (entityTypes.includes(domain))
                        match = true;
                }
                if (!match)
                    return;

                const domains = this._domains.getDomainsByWikidataTypes(entityTypes);
                for (const domain of domains) {
                    // add wikidata item in the domain 
                    // set QID as label as fallback, and update with labels later
                    const items = this._items.get(domain)!;
                    items.set(item.key, item.key);
                    // add predicates
                    for (const [property, values] of Object.entries(predicates)) {
                        if (!this._wikidataProperties.has(property))
                            continue;
                        if (!this._predicates.get(domain)!.has(property))
                            this._predicates.get(domain)!.set(property, []);
                        const predicate = this._predicates.get(domain)!.get(property)!;
                        for (const value of values) {
                            predicate.push(value);
                            // add values 
                            // set QID as label as fallback, and update with labels later
                            this._values.set(value, value);
                        }
                    }
                }
            });

            pipeline.on('error', (error) => console.error(error));
            await StreamUtils.waitEnd(pipeline);
        }
    }

    private async _loadWikidataTypes() {
        for (const kbFile of this._paths.wikidata) {
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
    }

    private async _identifySymmetricProperties() {
        const relations = new Map();
        for (const kbFile of this._paths.wikidata) {
            const pipeline = fs.createReadStream(kbFile).pipe(JSONStream.parse('$*'));
            pipeline.on('data', async (item) => {
                for (const domain of this._domains.domains) {
                    if (!this._items.get(domain)!.has(item.key))
                        return;
                    for (const property in item.value) {
                        if (!this._predicates.get(domain)!.has(property))
                            continue;
                        if (!relations.has(property))
                            relations.set(property, new Map());
                        relations.get(property).set(item.key, item.value[property]);
                    }
                }
            });
            pipeline.on('error', (error) => console.error(error));
            await StreamUtils.waitEnd(pipeline);
        }
        const symmetricProperties = [];
        for (const [property, maps] of relations) {
            let count_bidirectional = 0;
            let count_unidirectional = 0;
            for (const [subject, objects] of maps) {
                for (const object of objects) {
                    if (!maps.has(object)) {
                        count_unidirectional += 1;
                        break;
                    }
                    if (!maps.get(object).includes(subject)) {
                        count_unidirectional += 1;
                        break;
                    }
                    count_bidirectional +=1;
                }
            }
            const total = (count_bidirectional + count_unidirectional) / 2;
            if (total < SYMMETRIC_PROPERTY_MIN_EXAMPLES)
                continue;
            if (count_bidirectional / 2 / total > SYMMETRIC_PROPERTY_THRESHOLD)
                symmetricProperties.push(property);
        }
        await util.promisify(fs.writeFile)(this._paths.symmetricProperties, symmetricProperties.join(','), { encoding: 'utf8' });
        
    }

    private async _loadBootlegTypes() {
        const bootlegTypeCanonical =  await readJson(this._paths.bootlegTypeCanonical);
        const pipeline = fs.createReadStream(this._paths.bootlegTypes).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (item) => {
            if (this._values.has(item.key))
                this._bootlegTypes.set(item.key, item.value.map((qid : string) => bootlegTypeCanonical.get(qid)));
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    private async _loadLabels() {
        const pipeline = fs.createReadStream(this._paths.wikidataEntities).pipe(JSONStream.parse('$*'));
        const valueTypes = new Set(Array.from(this._types.values()).flat());
        pipeline.on('data', async (entity) => {
            const qid = String(entity.key);
            const label = String(entity.value);
            for (const domain of this._domains.domains) {
                if (this._items.get(domain)!.has(qid))
                    this._items.get(domain)!.set(qid, label);
            }
            if (this._values.has(qid) || valueTypes.has(qid)) 
                this._values.set(qid, label);   
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    private _addToValueSet(type : string, entry : string[]|EntityParameterData) {
        if (this._valueSets.has(type))
            this._valueSets.get(type)!.push(entry);
        else 
            this._valueSets.set(type, [entry]);
    }

    private _getEntityType(qid : string) : string|null {
        const bootlegTypes = this._bootlegTypes.get(qid);
        // return the first type in bootleg
        if (bootlegTypes && bootlegTypes.length > 0) 
            return argnameFromLabel(bootlegTypes[0]);
        
        // fallback to the first wikidata type with label
        const wikidataTypes = this._types.get(qid);
        if (!wikidataTypes)
            return null;
        for (const type of wikidataTypes) {
            const entityType = this._values.get(type);
            if (entityType) {
                console.warn(`Bootleg does not have ${qid}, fall back to CSQA type`);
                return argnameFromLabel(entityType);
            }
        }
        return null;
    }

    /**
     * Generates paramter-datasets. Iterate through each domain properties.
     * Find data type and value and output corresponding json/tsv files.
     */
    private async _generateParameterDatasets() {
        await this._outputDomainValueSet();
        await this._outputParameterValueSet();
        this._manifest.end();
        await StreamUtils.waitFinish(this._manifest);
    }

    private async _outputDomainValueSet() {
        for (const domain of this._domains.domains) {
            console.log('Processing entities for domain:', domain);
            const data = [];
            for (const [value, label] of this._items.get(domain)!) {
                const tokenized = this._tokenizer.tokenize(label).tokens.join(' ');
                data.push({ value, name: label, canonical: tokenized });
            }
            await this._outputEntityValueSet(`org.wikidata:${domain}`, data);
        }   
    }

    private async _outputParameterValueSet() {
        for (const domain of this._domains.domains) {
            console.log('Processing properties for domain:', domain);
            for (const [property, values] of this._predicates.get(domain)!) {
                // all properties in CSQA has entity values, skip if no value has been found
                if (values.length === 0)
                    continue; 
                const propertyLabel = this._wikidataProperties.get(property)!;
                const thingtalkPropertyType = 'p_' + argnameFromLabel(propertyLabel);
                console.log('Processing property:', propertyLabel);
                const thingtalkEntityTypes : Set<string> = new Set();
                for (const value of values) {               
                    const valueLabel = this._values.get(value)!;
                    // Tokenizer throws error.
                    if (valueLabel.includes('æ'))
                        continue;
                    const tokens = this._tokenizer.tokenize(valueLabel).tokens;
                    if (this._maxValueLength && tokens.length > this._maxValueLength) 
                        continue;
                    const tokenized = tokens.join(' ');
                    
                    if (this._typeSystem === 'string') {
                        this._addToValueSet(thingtalkPropertyType, [valueLabel, tokenized, "1"]);
                        continue;
                    } 
                    
                    const entry = { value, name: valueLabel, canonical: tokenized };
                    // add to property value set
                    this._addToValueSet(thingtalkPropertyType, entry);
                    this._thingtalkEntityTypes.set(value, thingtalkPropertyType);
                    
                    if (this._typeSystem === 'entity-hierarchical') {
                        // skip entities with no type information
                        if (!this._types.has(value))
                            continue;
                        const valueType = this._getEntityType(value);
                        // value does not have value for "instance of" field
                        if (!valueType)
                            continue;
                        // add to entity type value set
                        thingtalkEntityTypes.add(valueType);
                        this._addToValueSet(valueType, entry);
                        this._thingtalkEntityTypes.set(value, valueType);
                    }         
                }
                if (this._typeSystem === 'entity-hierarchical')
                    this._subtypes.set(thingtalkPropertyType, Array.from(thingtalkEntityTypes));
                this._filteredPropertiesByDomain.get(domain)!.push(property);
            }
        }
        for (const [valueType, examples] of this._valueSets) {
            if (this._typeSystem === 'string') {
                await this._outputStringValueSet(valueType, examples as string[][]);
            } else {
                const type = `org.wikidata:${valueType}`;
                await this._outputEntityValueSet(type, examples as EntityParameterData[]);
            }
        }
    }

    async run() {
        console.log('loading property labels ...');
        this._wikidataProperties = await readJson(this._paths.wikidataProperties);
        console.log('loading predicates ...');
        await this._loadPredicates();
        console.log('loading value types ...');
        await this._loadWikidataTypes();
        console.log('loading entity labels ...');
        await this._loadLabels();
        console.log('identifying symmetric properties ...');
        await this._identifySymmetricProperties();

        if (this._paths.bootlegTypes) {
            console.log('loading bootleg types ...');
            await this._loadBootlegTypes();
        }

        console.log('generating parameter datasets ...');
        await this._generateParameterDatasets();

        console.log('dumping files');
        await dumpMap(this._paths.subtypes, this._subtypes);
        await dumpMap(this._paths.filteredProperties, this._filteredPropertiesByDomain);
        await dumpMap(path.join(this._paths.dir, 'values.json'), this._values);
        await dumpMap(path.join(this._paths.dir, 'items.json'), this._items);
        await dumpMap(path.join(this._paths.dir, 'types.json'), this._thingtalkEntityTypes);
    }
}

module.exports = {
    initArgparse(subparsers : argparse.SubParser) {
        const parser = subparsers.add_parser('wikidata-preprocess-knowledge-base', {
            add_help: true,
            description: "Generate parameter-datasets.tsv from processed wikidata dump. "
        });
        parser.add_argument('--locale', {
            required: false,
            default: 'en-US'
        });
        parser.add_argument('--domains', {
            required: true,
            help: 'the path to the file containing type mapping for all domains to include'
        });
        parser.add_argument('--type-system', {
            required: true,
            choices: ['entity-plain', 'entity-hierarchical', 'string'],
            help: 'design choices for the type system:\n' +
                'entity-plain: one entity type per property\n' +
                'entity-hierarchical: one entity type for each value, and the property type is the supertype of all types of its values\n' +
                'string: all property has a string type except id',
            default: 'entity-hierarchical'
        });
        parser.add_argument('--wikidata', {
            required: false,
            nargs: '+',
            help: "full knowledge base of wikidata, named wikidata_short_1.json and wikidata_short_2.json"
        });
        parser.add_argument('--wikidata-entity-list', {
            required: false,
            help: "full list of entities in the wikidata dump, named items_wikidata_n.json in CSQA, " + 
                "in the form of a dictionary with QID as keys and canonical as values."
        });
        parser.add_argument('--wikidata-property-list', {
            required: true,
            help: "full list of properties in the wikidata dump, named filtered_property_wikidata4.json"
                + "in CSQA, in the form of a dictionary with PID as keys and canonical as values."
        });
        parser.add_argument('--subtypes', {
            required: true,
            help: "Path to output a json file containing the sub type information for properties"
        });
        parser.add_argument('--filtered-properties', {
            required: true,
            help: "Path to output a json file containing properties available for each domain"
        });
        parser.add_argument('--symmetric-properties', {
            required: true,
            help: "Path to output a txt file containing symmetric properties for the domain, split by comma"
        });
        parser.add_argument('--bootleg-types', {
            required: false,
            help: "Path to types used for each entity in Bootleg"
        });
        parser.add_argument('--bootleg-type-canonicals', {
            required: false,
            help: "Path to the json file containing canoncial for each bootleg type"
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

    async execute(args : any) {
        const domains = new Domains({ path: args.domains });
        await domains.init();

        const paramDatasetGenerator = new ParamDatasetGenerator({
            locale: args.locale,
            domains,
            typeSystem: args.type_system,
            wikidata: args.wikidata,
            wikidataEntities: args.wikidata_entity_list,
            wikidataProperties: args.wikidata_property_list,
            subtypes: args.subtypes,
            filteredProperties: args.filtered_properties,
            symmetricProperties: args.symmetric_properties,
            bootlegTypes: args.bootleg_types,
            bootlegTypeCanonical: args.bootleg_type_canonicals,
            maxValueLength: args.max_value_length,
            manifest: args.manifest,
            outputDir: args.output_dir
        });
        paramDatasetGenerator.run();
    }
};