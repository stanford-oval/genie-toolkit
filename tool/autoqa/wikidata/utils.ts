// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Silei Xu <silei@cs.stanford.edu>

import * as fs from 'fs';
import util from 'util';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import JSONStream from 'JSONStream';
import csvparse from 'csv-parse';
import * as StreamUtils from '../../../lib/utils/stream-utils';
import { snakecase } from '../lib/utils';
import { clean } from '../../../lib/utils/misc-utils';

const URL = 'https://query.wikidata.org/sparql';
const Type = ThingTalk.Type;

const _cache = new Map();

const WikidataUnitToTTUnit : Record<string, string> = {
    // time
    'millisecond': 'ms',
    'second': 's',
    'minute': 'min',
    'hour': 'h',
    'day': 'day',
    'week': 'week',
    'month': 'mon',
    'year': 'year',
    // length
    'millimetre': 'mm',
    'centimetre': 'cm',
    'metre': 'm',
    'kilometre': 'km',
    'inch': 'in',
    'foot': 'ft',
    'mile': 'mi',
    // area
    'square millimetre': 'mm2',
    'square centimetre': 'cm2',
    'square metre': 'm2',
    'square kilometre': 'km2',
    'square inch': 'in2',
    'square foot': 'ft2',
    'square mile': 'mi2',
    // volume
    'cubic millimetre': 'mm3',
    'cubic centimetre': 'cm3',
    'cubic metre': 'm3',
    'cubic kilometre': 'km3',
    'cubic inch': 'in3',
    'cubic foot': 'ft3',
    'cubic mile': 'mi3',
    'gallon (US)': 'gal',
    'gallon (UK)': 'galuk',
    'liquid quart (US)': 'quart',
    'quart (UK)': 'qtuk',
    'liquid pint': 'pint',
    'pint (UK)': 'pintuk',
    'litre': 'l',
    'hectoliter': 'hl',
    'centilitre': 'cl',
    'millilitre': 'ml',
    'teaspoon': 'tsp',
    'tablespoon': 'tbsp',
    'cup': 'cup',
    'fluid ounce': 'floz',
    // speed
    'metre per second': 'mps',
    'kilometre per hour': 'kmph',
    'miles per hour': 'mph',
    // weight
    'kilogram': 'kg',
    'gram': 'g',
    'milligram': 'mg',
    'pound': 'lb',
    'ounce': 'oz',
    // pressure
    'pascal': 'Pa',
    'bar': 'bar',
    'pound per square inch': 'psi',
    'millimeter of mercury': 'mmHg',
    'standard atmosphere': 'atm',
    // temperature
    'degree Celsius': 'C',
    'degree Fahrenheit': 'F',
    'kelvin': 'K',
    // energy
    'kilojoule': 'KJ',
    'kilocalorie': 'kcal',
    // file and memory size
    'byte': 'byte',
    'kilobyte': 'KB',
    'kibibyte': 'KiB',
    'megabyte': 'MB',
    'mebibyte': 'MiB',
    'gigabyte': 'GB',
    'gibibyte': 'GiB',
    'terabyte': 'TB',
    'tebibyte': 'TiB',
    // power
    'watt': 'W',
    'kilowatt': 'kW',
    // luminous flux, luminous power
    'lumen': 'lm',
    // luminous emittance
    'lux': 'lx',
    // decibel
    'decibel': 'dB',
    // decibel-milliwatts,
    'dBm': 'dBm',

    // currency
    'United States dollar': 'usd',
    'euro': 'eur',
    'renminbi': 'cny',
    'Iranian rial': 'irr',
    'Hong Kong dollar': 'hkd',
    'Japanese yen': 'jpy',
    'South Korean won': 'krw',
    'pound sterling': 'gbp',
    'Indian rupee': 'inr',
    'Canadian dollar': 'cad',
    'Australian dollar': 'aud',
    'Swiss franc': 'chf',
};

/**
 * Covert wikidata unit into thingtalk unit
 * @param wikidataUnit
 */
function unitConverter(wikidataUnit : string) : string {
    return WikidataUnitToTTUnit[wikidataUnit];
}

/**
 * Run SPARQL query on wikidata endpoint and retrieve results
 * @param {string} query: SPARQL query
 * @returns {Promise<*>}
 */
async function wikidataQuery(query : string) : Promise<any[]> {
    if (_cache.has(query))
        return _cache.get(query);
    try {
        const result = await Tp.Helpers.Http.get(`${URL}?query=${encodeURIComponent(query)}`, {
            accept: 'application/json'
        });
        const parsed = JSON.parse(result).results.bindings;
        _cache.set(query, parsed);
        return parsed;
    } catch(e) {
        throw new Error('The connection timed out waiting for a response');
    }
}

/**
 * Get the label of a given property
 * @param {string} propertyId: the id of the property
 * @returns {Promise<null|string>}: the label of the property
 */
async function getPropertyLabel(propertyId : string) : Promise<string|null> {
    const query = `SELECT DISTINCT ?propLabel WHERE {
         ?prop wikibase:directClaim wdt:${propertyId} .
         SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1`;
    const result = await wikidataQuery(query);
    if (result.length > 0)
        return result[0].propLabel.value;
    return null;
}

/**
 * Get alternative labels of a given property
 * @param {string} propertyId: the id of the property
 * @returns {Promise<Array.string>}: the label of the property
 */
async function getPropertyAltLabels(propertyId : string) : Promise<string[]|null> {
    const query = `SELECT DISTINCT ?propAltLabel WHERE {
         ?prop wikibase:directClaim wdt:${propertyId} .
         SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    const result = await wikidataQuery(query);
    if (result.length > 0 && result[0].propAltLabel)
        return result[0].propAltLabel.value.split(',');
    return null;
}

/**
 * Get the label of a given item
 * @param {string} itemId: the id of the item
 * @returns {Promise<null|string>}: the label of the item
 */
async function getItemLabel(itemId : string) : Promise<string|null> {
    const query = `SELECT ?label WHERE {
        wd:${itemId} rdfs:label ?label .
        FILTER (langMatches( lang(?label), "en" ) )
    } LIMIT 1`;
    const result = await wikidataQuery(query);
    if (result.length > 0)
        return result[0].label.value;
    return null;
}

/**
 * Get a list of common properties given a domain
 * @param {string} domainId: the id of the domain, e.g. "Q5" for human domain
 * @returns {Promise<Array.string>}: a list of property ids
 */
async function getPropertyList(domainId : string) : Promise<string[]> {
    const query = `SELECT ?property WHERE {
        wd:${domainId} wdt:P1963 ?property .
    }`;
    const result = await wikidataQuery(query);
    return result.map((r : any) => r.property.value.slice('http://www.wikidata.org/entity/'.length));
}

/**
 * Get the value type constraint (Q21510865) of a property
 * @param {string} propertyId
 * @returns {Promise<Array.Object<id,value>>} A list of allowed value types and their labels
 */
async function getValueTypeConstraint(propertyId : string) : Promise<Array<Record<string, string>>> {
    const query = `SELECT ?value ?valueLabel WHERE {
        wd:${propertyId} p:P2302 ?statement .
        ?statement ps:P2302 wd:Q21510865 .
        ?statement pq:P2308 ?value .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    const result = await wikidataQuery(query);
    return result.map((r : any) => {
        return { id: r.value.value, label: r.valueLabel.value };
    });
}

/**
 * Get the one-of constraint (Q21510859) of a property
 * This allows to detect Enum types
 *
 * @param propertyId
 * @returns {Promise<Array.String>} A list of enum values
 */
async function getOneOfConstraint(propertyId : string) : Promise<string[]> {
    const query = `SELECT ?value ?valueLabel WHERE {
        wd:${propertyId} p:P2302 ?statement .
        ?statement ps:P2302 wd:Q21510859 .
        ?statement pq:P2305 ?value .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.valueLabel.value);
}

/**
 * Get the allowed units (Q21514353) of a property
 * This allows to detect Measure types
 *
 * @param propertyId
 * @returns {Promise<Array.String>} A list of allowed units
 */
async function getAllowedUnits(propertyId : string) : Promise<string[]> {
    const query = `SELECT ?value ?valueLabel WHERE {
        wd:${propertyId} p:P2302 ?statement .
        ?statement ps:P2302 wd:Q21514353 .
        ?statement pq:P2305 ?value .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.valueLabel.value);
}

/**
 * Get the range of a numeric field
 *
 * @param propertyId
 * @returns {Object<max, min>|null} A list of allowed units
 */
async function getRangeConstraint(propertyId : string) : Promise<Record<string, number>|null> {
    const query = `SELECT ?max ?min WHERE {
        wd:${propertyId} p:P2302 ?statement .
        ?statement ps:P2302 wd:Q21510860 .
        ?statement pq:P2312 ?max .
        ?statement pq:P2313 ?min .

    }`;
    const result = await wikidataQuery(query);
    if (result.length > 0) {
        const range : Record<string, number> = {};
        if (result[0].max)
            range.max = result[0].max.value;
        if (result[0].min)
            range.min = result[0].min.value;
        if (Object.keys(range).length > 0)
            return range;
    }
    return null;
}

/**
 * Get the class (instance of) of a given wikidata property or entity
 * @param {string} id: the id of a property or an entity
 * @returns {Promise<Array.string>}: list of classes
 */
async function getClasses(id : string) : Promise<string[]> {
    const query = `SELECT ?class WHERE {
        wd:${id} wdt:P31 ?class .
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.class.value.slice('http://www.wikidata.org/entity/'.length));
}

/**
 * Get wikidata equivalent of a given wikidata property or entity
 * @param {string} id: the id of a property or an entity
 * @returns {Promise<Array.string>}: list of classes
 */
async function getEquivalent(id : string) : Promise<string[]> {
    const query = `SELECT ?class WHERE {
        wd:${id} wdt:P460 ?class .
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.class.value.slice('http://www.wikidata.org/entity/'.length));
}

async function getType(property : string) : Promise<InstanceType<typeof Type>> {
    const classes = await getClasses(property); 
    if (classes.includes('Q18636219')) // Wikidata property with datatype 'time'
        return Type.Date;

    const units = await getAllowedUnits(property);
    if (units.length > 0) {
        if (units.includes('kilogram'))
            return new Type.Measure('kg');
        if (units.includes('metre') ||  units.includes('kilometre'))
            return new Type.Measure('m');
        if (units.includes('second') || units.includes('year'))
            return new Type.Measure('ms');
        if (units.includes('degree Celsius'))
            return new Type.Measure('C');
        if (units.includes('metre per second') || units.includes('kilometre per second'))
            return new Type.Measure('mps');
        if (units.includes('square metre'))
            return new Type.Measure('m2');
        if (units.includes('cubic metre'))
            return new Type.Measure('m3');
        if (units.includes('percent'))
            return Type.Number;
        if (units.includes('United States dollar'))
            return Type.Currency;
        if (units.includes('years old'))
            return Type.Number; // To-do
        if (units.includes('gram per cubic metre'))
            return Type.Number; // To-do
        console.error(`Unknown measurement type with unit ${units.join(', ')} for ${property}`);
        return Type.Number;
    }

    const range = await getRangeConstraint(property);
    if (range)
        return Type.Number;

    const subpropertyOf = await wikidataQuery(`SELECT ?value WHERE { wd:${property} wdt:P1647 ?value. } `);
    if (subpropertyOf.some((property) => property.value.value === 'http://www.wikidata.org/entity/P18'))
        return new Type.Entity('tt:picture');
    if (subpropertyOf.some((property) => property.value.value === 'http://www.wikidata.org/entity/P2699'))
        return new Type.Entity('tt:url');

    // majority or arrays of string so this may be better default.
    return Type.String;
}

function argnameFromLabel(label : string) : string {
    // if label is a keyword or starts with number
    if (ThingTalk.Syntax.KEYWORDS.has(label) || /^\d/.test(label))
        label = `_${label}`;
    return snakecase(label)
        .replace(/'/g, '') // remove apostrophe
        .replace(/,/g, '') // remove comma
        .replace(/_\/_/g, '_or_') // replace slash by or
        .replace(/[(|)]/g, '') // replace parentheses
        .replace(/-/g, '_') // replace -
        .replace(/\s/g, '_') // replace whitespace
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accent
        .replace(/[\W]+/g, '');
}

function getElementType(type : InstanceType<typeof Type>) : InstanceType<typeof Type> {
    if (type instanceof Type.Array)
        return getElementType(type.elem as InstanceType<typeof Type>);
    return type;
}

async function readJson(file : string) {
    const data = new Map();
    const pipeline = fs.createReadStream(file).pipe(JSONStream.parse('$*'));
    pipeline.on('data', (item : { key : string, value : string}) => {
        data.set(item.key, item.value);
    });
    pipeline.on('error', (error : Error) => console.error(error));
    await StreamUtils.waitEnd(pipeline);
    return data;
}

async function dumpMap(file : string, map : Map<string, any>) {
    const data : Record<string, any> = {};
    for (const [key, value] of map) 
        data[key] = value instanceof Map ? Object.fromEntries(value) : value;
    await util.promisify(fs.writeFile)(file, JSON.stringify(data, undefined, 2));
}

class Domains {
    private _path : string;
    private _map : Record<string, Record<string, any>>;
    private _domains : string[];
    private _csqaTypes : string[];
    private _wikidataTypes : string[];

    constructor(options : { path : string }) {
        this._path = options.path;
        this._map = {};
        this._domains = [];
        this._csqaTypes = [];
        this._wikidataTypes = [];
    }

    get domains() {
        return this._domains;
    }

    get wikidataTypes() {
        return this._wikidataTypes;
    }

    async init() {
        const pipeline = fs.createReadStream(this._path).pipe(csvparse({ 
            columns: ['domain', 'csqa-type', 'wikidata-types', 'all-types'], 
            delimiter: '\t', 
            relax: true 
        }));
        pipeline.on('data', (row) => {
            this._domains.push(row.domain);
            if (!this._csqaTypes.includes(row['csqa-type'])) 
                this._csqaTypes.push(row['csqa-type']);
            for (const entry of row['wikidata-types'].split(' ')) {
                const type = entry.split(':')[0];
                if (!this._wikidataTypes.includes(type))
                    this._wikidataTypes.push(type);
            }
            const csqaType = row['csqa-type'];
            const wikidataTypes = row['wikidata-types'].split(' ').map((x : string) => x.split(':')[0]);
            const wikidataTypeLabels = row['wikidata-types'].split(' ').map((x : string) => x.split(':')[1]);
            this._map[row.domain] = {
                'csqa-type': csqaType,
                'wikidata-types': wikidataTypes,
                'wikidata-types-labels': wikidataTypeLabels.map(clean),
                'wikidata-subject': [csqaType, ...wikidataTypes],
            };
        });
        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    getCSQAType(domain : string) : string {
        return this._map[domain]['csqa-type'];
    }

    getWikidataTypes(domain : string) : string[] {
        return this._map[domain]['wikidata-types'];
    }

    getWikidataTypeLabels(domain : string) : string[] {
        return this._map[domain]['wikidata-types-labels'];
    }

    getWikidataSubjects(domain : string) : string[] {
        return this._map[domain]['wikidata-subject'];
    }

    getDomainByCSQAType(csqaType : string) : string|null {
        for (const [domain, map] of Object.entries(this._map)) {
            if (map['csqa-type'] === csqaType)
                return domain;
        }
        return null;
    }

    getDomainsByWikidataType(wikidataType : string) : string[] {
        const domains = [];
        for (const [domain, map] of Object.entries(this._map)) {
            if (map['wikidata-types'].includes(wikidataType))
                domains.push(domain);
        }
        return domains;
    }
    
    getDomainsByWikidataTypes(wikidataTypes : string[]) : string[] {
        const domains = wikidataTypes.map((type : string) => this.getDomainsByWikidataType(type));
        return [...new Set(domains.flat())];
    }
}

export {
    unitConverter,
    wikidataQuery,
    getPropertyLabel,
    getPropertyAltLabels,
    getItemLabel,
    getPropertyList,
    getValueTypeConstraint,
    getOneOfConstraint,
    getAllowedUnits,
    getRangeConstraint,
    getClasses,
    getEquivalent,
    getType,
    getElementType,
    readJson,
    dumpMap,
    argnameFromLabel,
    Domains
};