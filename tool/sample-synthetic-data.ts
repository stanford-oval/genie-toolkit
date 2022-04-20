// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Jake Wu <jmhw0123@gmail.com>

import * as argparse from 'argparse';
import * as fs from 'fs';
import * as Tp from 'thingpedia';
import * as I18n from '../lib/i18n';
import * as utils from '../lib/utils/misc-utils';
import { Ast, Type, SchemaRetriever, Builtin } from 'thingtalk';
import { ParaphraseExample } from './autoqa/lib/canonical-example-constructor';
// import { generateExamples as generateQueryExamples } from './autoqa/lib/canonical-example-constructor';
import { parseConstantFile } from './lib/constant-file';
import { getElementType } from './autoqa/wikidata/utils';
import { WikidataUnitToTTUnit } from './autoqa/wikidata/utils';
import { makeLookupKeys } from '../lib/dataset-tools/mturk/sample-utils';
import { 
    PARTS_OF_SPEECH, 
    PROJECTION_PARTS_OF_SPEECH, 
    Canonicals, 
    CanonicalAnnotation 
} from './autoqa/lib/base-canonical-generator';
import genBaseCanonical from './autoqa/lib/base-canonical-generator';
import { serializePrediction } from '../lib/utils/thingtalk';
import { EntityUtils } from '../lib';
import Path = require('path');
import { Temporal } from '@js-temporal/polyfill';
// import { ResultGenerator } from '../lib/dialogue-agent/simulator/simulation_exec_environment';

interface NewParaphraseExample extends ParaphraseExample {
    thingtalk : string
}

interface Constant {
    key ?: string;
    value : any;
    display : string;
    unit ?: string;
}

const CITIES = [
    'New York',
    'Los Angeles',
    'Chicago',
    'Houston',
    'Phoenix',
    'San Antonio',
    'Philadelphia',
    'San Diego',
    'Dallas',
    'Austin',
    'San Jose',
    'Fort Worth',
    'Jacksonville',
    'Charlotte',
    'Columbus',
    'Indianapolis',
    'San Francisco',
    'Seattle',
    'Denver',
    'Washington',
    'Boston',
    'El Paso',
    'Nashville',
    'Oklahoma City',
    'Las Vegas',
    'Portland',
    'Detroit',
    'Memphis',
    'Louisville',
    'Milwaukee',
    'Baltimore',
    'Albuquerque',
    'Tucson',
    'Mesa',
    'Fresno',
    'Atlanta',
    'Sacramento',
    'Kansas City',
    'Colorado Springs',
    'Raleigh',
    'Miami',
    'Omaha',
    'Long Beach',
    'Virginia Beach',
    'Oakland',
    'Minneapolis',
    'Tampa',
    'Tulsa',
    'Arlington',
    'Aurora',
    'Wichita',
    'Bakersfield',
    'New Orleans',
    'Cleveland',
    'Henderson',
    'Anaheim',
    'Honolulu',
    'Riverside',
    'Santa Ana',
    'Corpus Christi',
    'Lexington',
    'San Juan',
    'Stockton',
    'St. Paul',
    'Cincinnati',
    'Irvine',
    'Greensboro',
    'Pittsburgh',
    'Lincoln',
    'Durham',
    'Orlando',
    'St. Louis',
    'Chula Vista',
    'Plano',
    'Newark',
    'Anchorage',
    'Fort Wayne',
    'Chandler',
    'Reno',
    'North Las Vegas',
    'Scottsdale',
    'St. Petersburg',
    'Laredo',
    'Gilbert',
    'Toledo',
    'Lubbock',
    'Madison',
    'Glendale',
    'Jersey City',
    'Buffalo',
    'Chesapeake',
    'Winston-Salem',
    'Fremont',
    'Norfolk',
    'Frisco',
    'Paradise',
    'Irving',
    'Garland',
    'Richmond',
    'Arlington',
    'Boise',
    'Spokane',
    'Hialeah',
    'Moreno Valley',
    'Tacoma',
    'Port St. Lucie',
    'McKinney',
    'Fontana',
    'Modesto',
    'Fayetteville',
    'Baton Rouge',
    'San Bernardino',
    'Santa Clarita',
    'Cape Coral',
    'Des Moines',
    'Tempe',
    'Huntsville',
    'Oxnard',
    'Spring Valley',
    'Birmingham',
    'Rochester',
    'Overland Park',
    'Grand Rapids',
    'Yonkers',
    'Salt Lake City',
    'Columbus',
    'Augusta',
    'Amarillo',
    'Tallahassee',
    'Ontario',
    'Montgomery',
    'Little Rock',
    'Akron',
    'Huntington Beach',
    'Grand Prairie',
    'Glendale',
    'Sioux Falls',
    'Sunrise Manor',
    'Aurora',
    'Vancouver',
    'Knoxville',
    'Peoria',
    'Mobile',
    'Chattanooga',
    'Worcester',
    'Brownsville',
    'Fort Lauderdale',
    'Newport News',
    'Elk Grove',
    'Providence',
    'Shreveport',
    'Salem',
    'Pembroke Pines',
    'Eugene',
    'Rancho Cucamonga',
    'Cary',
    'Santa Rosa',
    'Fort Collins',
    'Oceanside',
    'Corona',
    'Enterprise',
    'Garden Grove',
    'Springfield',
    'Clarksville',
    'Murfreesboro',
    'Lakewood',
    'Bayamon',
    'Killeen',
    'Alexandria',
    'Midland',
    'Hayward',
    'Hollywood',
    'Salinas',
    'Lancaster',
    'Macon',
    'Surprise',
    'Kansas City',
    'Sunnyvale',
    'Palmdale',
    'Bellevue',
    'Springfield',
    'Denton',
    'Jackson',
    'Escondido',
    'Pomona',
    'Naperville',
    'Roseville',
    'Thornton',
    'Round Rock',
    'Pasadena',
    'Joliet',
    'Carrollton',
    'McAllen',
    'Paterson',
    'Rockford',
    'Waco',
    'Bridgeport',
    'Miramar',
    'Olathe',
    'Metairie'
];

function typeToString(type : Type) : string {
    const elemType = getElementType(type);
    if (elemType instanceof Type.Entity)
        return elemType.type;
    return type.toString();
}

function countArgTypes(schema : Ast.FunctionDef) : Record<string, number> {
    const count : Record<string, number> = {};
    for (const arg of schema.iterateArguments()) {
        const typestr = typeToString(arg.type);
        if (!typestr)
            continue;
        count[typestr] = (count[typestr] || 0) + 1;
    }
    return count;
}

function checkOutputPath(args : any) {
    if (!args.output) {
        const outputDir = Path.join(Path.dirname(args.thingpedia), "test");
        if (!fs.existsSync(outputDir))
            fs.mkdirSync(outputDir);
        args.output = fs.createWriteStream(Path.join(outputDir, "samples.tsv"));
    }
}

function parseConstantKeys(classDef : Ast.ClassDef, 
                           sampleMeta : Record<string, Constant[]>, 
                           fname : string, 
                           arg : Ast.ArgumentDef) : Constant[] {
    //TODO: also use enum canonicals?
    const keys = makeLookupKeys('@' + classDef.kind + '.' + fname, arg.name, arg.type);
    let sampleConstants : Constant[] = [];
    for (const key of keys) {
        if (sampleMeta[key]) {
            sampleConstants = sampleMeta[key];
            break;
        }
    }
    return sampleConstants;
}

function randomInt(low : number, high : number, rng : () => number) : number {
    return Math.round(low + (high - low) * rng());
}

function makeJSDate(year : number, month : number, day : number) : Date {
    const timezone = Temporal.Now.timeZone().id;
    const datetz = Temporal.ZonedDateTime.from({
        timeZone: timezone,
        year, month, day
    });
    return new Date(datetz.epochMilliseconds);
}

function generateRandomIntArray(max : number, sampleSize : number) {
    return Array.from({ length : sampleSize }, () => randomInt(0, max, Math.random));
}

function generateDateArray(timezone : string, sampleSize : number) {
    const _getDates = function(startDate : Date, period : number) {
        const dates = [];
        let i = 0;
        const d = new Date(startDate);
        while (i++ < period) {
            dates.push(new Date(d));
            d.setDate(d.getDate() + 1);
        }
        return dates;
    };
    const today = Temporal.Now.zonedDateTime('iso8601', timezone).withPlainTime({ hour: 0, minute: 0, second: 0 });
    const startDate = new Date(today.epochMilliseconds);
    return _getDates(startDate, sampleSize);
}

function generateTimeArray(sampleSize : number) {
    const times = [];
    for (let i=0; i<sampleSize; i++) {
        const newTime = new Builtin.Time(randomInt(0, 23, Math.random), randomInt(0, 59, Math.random), 0);
        times.push(newTime);
    }
    return times;
}

function generateLocationArray(sampleSize : number) {
    if (sampleSize < CITIES.length)
        return CITIES.sort(() => 0.5 - Math.random()).slice(0, sampleSize);
    else 
        return CITIES;
}

async function retrieveSampleValues(classDef : Ast.ClassDef, 
                                    sampleMeta : Record<string, Constant[]>, 
                                    fname : string, 
                                    argDef : Ast.ArgumentDef,
                                    sampleSize : number) : Promise<string[]> {
    if (argDef.type instanceof Type.Enum) 
        return argDef.type.entries!.slice(0, sampleSize);
    if ((argDef.type instanceof Type.Measure) || (argDef.type === Type.Currency))
        return generateRandomIntArray(100, sampleSize).map(String);
    if (argDef.type === Type.Date) {
        const timezone = Temporal.Now.timeZone().id;
        return generateDateArray(timezone, sampleSize).map((x) => x.toISOString().substring(0,10));
    }
    if (argDef.type === Type.Time)
        return generateTimeArray(sampleSize).map((x) => x.toString());
    if (argDef.type === Type.Location)
        return generateLocationArray(sampleSize);
    const sampleConstants = parseConstantKeys(classDef, sampleMeta, fname, argDef);
    const ret = sampleConstants.map((v) => {
        if ((argDef.type === Type.String) || 
            (argDef.type instanceof Type.Array && ((argDef.type.elem as Type) === Type.String)))
            return v.value;
        return v.display;
    });
    return ret.length > sampleSize ? ret.slice(0, sampleSize) : ret;
}

function toThingtalkValue(classDef : Ast.ClassDef, 
                          sampleMeta : Record<string, Constant[]>, 
                          fname : string, 
                          argDef : Ast.ArgumentDef, 
                          value : string) : { value : Ast.Value; op : string; } {
    value = value.toLowerCase();
    let type = argDef.type;
    if (type instanceof Type.Entity) {
        const sampleConstants = parseConstantKeys(classDef, sampleMeta, fname, argDef);
        const kv = sampleConstants.find((item) => item.value.display?.toLowerCase() === value);
        const ttValue = kv?.value.value.toLowerCase();
        const ttDisplay = kv?.value.display.toLowerCase();
        return { value: new Ast.Value.Entity(ttValue, type.type, ttDisplay), op: "==" };
    }
    if (type instanceof Type.Enum)
        return { value: new Ast.Value.Enum(value), op: "==" };
    if (type === Type.String)
        return { value: new Ast.Value.String(value), op: "=~" };
    if (type === Type.Number)
        return { value: new Ast.Value.Number(parseFloat(value)), op: "==" };
    if (type instanceof Type.Measure)
        return { value: new Ast.Value.Measure(parseFloat(value), type.unit), op: "==" };
    if (type === Type.Currency)
        // TODO: check code?
        return { value: new Ast.Value.Currency(parseFloat(value), 'usd'), op: "==" };
    if (type === Type.Date) {
        const [y, m, d] = value.split('-').map(Number);
        return { value: new Ast.Value.Date(makeJSDate(y, m, d)), op: "==" };
    }
    if (type === Type.Time) {
        const [h, m] = value.split(':').map(Number);
        return { value: new Ast.Value.Time(new Ast.Time.Absolute(h, m, 0)), op: "==" };
    }
    if (type === Type.Location) {
        // const location = await tpClient.lookupLocation(value).then(
        //     (loc) => {
        //         console.log(loc);
        //         return loc.filter((val: { address: { country_code: string; }; }) => val.address.country_code.toLowerCase() === 'us'
        //     )[0]}
        // );
        // const newLocation = new Ast.Location.Absolute(location.latitude, location.longitude, location.display);
        const newLocation = new Ast.Location.Unresolved(value);
        return { value: new Ast.Value.Location(newLocation), op: "==" };
    }
    if (type instanceof Type.Array) {
        type = type.elem as Type;
        if (type instanceof Type.Entity) {
            const sampleConstants = parseConstantKeys(classDef, sampleMeta, fname, argDef);
            const kv = sampleConstants.find((item) => item.value.display?.toLowerCase() === value);
            const ttValue = kv?.value.value.toLowerCase();
            const ttDisplay = kv?.value.display.toLowerCase();
            return { value: new Ast.Value.Entity(ttValue, type.type, ttDisplay), op: "contains" };
        } else if (type === Type.String) {
            return { value: new Ast.Value.String(value), op: "contains~" };
        } else {
            throw new Error(`Unsupported value type: ${type}`);
        }
    }
    throw new Error(`Unsupported value type: ${type.prettyprint()}`);
}

function toTSV(device : string, data : NewParaphraseExample[], useHeading : boolean) {
    let headings = '';
    if (useHeading)
        headings = ["id", "utterance", "thingtalk"].join('\t') + '\n';
    const rows = data.reduce((acc : string[], colValue, idx) => {
        const id = `${device}-${idx.toLocaleString('en-US', { minimumIntegerDigits: 3, useGrouping:false })}`;
        const tmp = [
            id,
            colValue["utterance"],
            colValue["thingtalk"]
        ];
        return acc.concat([tmp.join('\t')]);
    }, []).join('\n');
    return `${headings}${rows}`;
}

function generateQueryExamples(query : Ast.FunctionDef,
                               arg : Ast.ArgumentDef, 
                               baseCanonicalAnnotation : CanonicalAnnotation, 
                               sampleValues : string[]) : ParaphraseExample[] {
    const examples : ParaphraseExample[] = [];
    const queryCanonical = Array.isArray(query.nl_annotations.canonical) ? query.nl_annotations.canonical[0] : query.nl_annotations.canonical;
    for (const [pos, canonicals] of Object.entries(baseCanonicalAnnotation)) {
        if (!PARTS_OF_SPEECH.includes(pos)) 
            continue;
        for (let canonical of canonicals) {
            if (PROJECTION_PARTS_OF_SPEECH.includes(pos)) {
                examples.push(...generateExamplesByPOS(query, queryCanonical, arg, canonical, pos));
            } else {
                for (const value of sampleValues) {
                    canonical = canonical.replace(/\$\{value.*/i, '#');
                    examples.push(...generateExamplesByPOS(query, queryCanonical, arg, canonical, pos, value));
                }
            }
        }    
    }
    return examples;
}

function isHumanType(type : Type) {
    if (type instanceof Type.Entity) {
        if (type.type === 'human')
            return true;
    }
    return false;
}

function generateExamplesByPOS(query : Ast.FunctionDef,
                               queryCanonical : string,
                               argument : Ast.ArgumentDef,
                               argumentCanonical : string,
                               pos : string, 
                               value ?: string|boolean) : ParaphraseExample[] {
    function example(utterance : string) : ParaphraseExample {
        return { query: query.name, queryCanonical, argument: argument.name, utterance, value, paraphrases : [] };
    }
    const interrogativePronoun = isHumanType(argument.type) ? 'who' : `which ${queryCanonical}`;
    if (!PROJECTION_PARTS_OF_SPEECH.includes(pos)) {
        if (!argumentCanonical.includes('#')) {
            if (argument.type instanceof Type.Measure) {
                const argType = argument.type;
                const unitName = Object.keys(WikidataUnitToTTUnit).find(
                    (key) => WikidataUnitToTTUnit[key].toLowerCase() === argType.unit.toString().toLowerCase()
                );
                argumentCanonical = argumentCanonical + ` # ${unitName}`;
            } else {
                argumentCanonical = argumentCanonical + ' #';
            }
        }
    }
    const predicate = typeof value === 'string' ? argumentCanonical.replace('#', value) : argumentCanonical;
    switch (pos) {
    case 'base':
        return [
            example(`What is the ${argumentCanonical} of the ${queryCanonical}?`),
            example(`What is the ${queryCanonical} 's ${argumentCanonical}?`),
            example(`What ${argumentCanonical} does the ${queryCanonical} have?`)
        ];
    case 'property':
    case 'property_true':
    case 'property_false':
        return [
            example(`Show me a ${queryCanonical} with ${predicate}.`),
            example(`${interrogativePronoun} has ${predicate}?`)
        ];
    case 'verb':
    case 'verb_true':
    case 'verb_false':
        return [
            example(`Show me a ${queryCanonical} that ${predicate}.`),
            example(`${interrogativePronoun} ${predicate}?`)
        ];
    case 'passive_verb':
    case 'passive_verb_true':
    case 'passive_verb_false':
    case 'preposition':
    case 'preposition_true':
    case 'preposition_false':
        return [
            example(`Show me a ${queryCanonical} ${predicate}.`),
            example(`${interrogativePronoun} is ${predicate}?`)
        ];
    case 'reverse_property':
    case 'reverse_property_true':
    case 'reverse_property_false':
        return [
            example(`${interrogativePronoun} is a ${predicate}?`)
        ];
    case 'adjective':
    case 'adjective_true':
    case 'adjective_false':
        return [
            example(`Show me a ${predicate} ${queryCanonical}.`),
            example(`${interrogativePronoun} is ${predicate}?`)
        ];
    case 'reverse_verb':
        return [
            example(`${interrogativePronoun} ${predicate} the ${queryCanonical}?`)
        ];
    default:
        return [];
    }
}

function generateBaseCanonicalAnnotation(func : Ast.FunctionDef, 
                                         arg : Ast.ArgumentDef, 
                                         typeCounts : Record<string, number>,
                                         queries : string[],
                                         remove_existing_canonicals : boolean) : CanonicalAnnotation {
    const canonicalAnnotation : CanonicalAnnotation = {};
    if (remove_existing_canonicals) {
        genBaseCanonical(canonicalAnnotation, arg.name, arg.type);
    } else {
        const existingCanonical : Record<string, any> = arg.getNaturalLanguageAnnotation('canonical') || {};
        if (typeof existingCanonical === 'string') 
            canonicalAnnotation.base = [existingCanonical];
        else if (Array.isArray(existingCanonical))
            canonicalAnnotation.base = existingCanonical;
        else if (typeof existingCanonical === 'object') 
            Object.assign(canonicalAnnotation, existingCanonical);
    }

    // remove function name in arg name, normally it's repetitive
    for (const [key, value] of Object.entries(canonicalAnnotation)) {
        if (PARTS_OF_SPEECH.includes(key)) {
            canonicalAnnotation[key as keyof Canonicals] = value.map((c : string) => {
                if (c.startsWith(func.name.toLowerCase() + ' '))
                    return c.slice(func.name.toLowerCase().length + 1);
                return c;
            });
        }
    }

    // copy base canonical if property canonical is missing
    if (canonicalAnnotation.base && !canonicalAnnotation.property)
        canonicalAnnotation.property = [...canonicalAnnotation.base];

    const typestr = typeToString(func.getArgType(arg.name)!);
    if (typestr && typeCounts[typestr] === 1) {
        // if an entity is unique, allow dropping the property name entirely
        // FIXME: consider type hierarchy, or probably drop it entirely
        // if (canonicalAnnotation.property && !queries.includes(typestr.substring(typestr.indexOf(':') + 1))) {            
        //     if (!canonicalAnnotation.property.includes('#') && 
        //         !((arg.type instanceof Type.Measure) || (arg.type === Type.Location)))
        //         canonicalAnnotation.property.push('#');
        // }

        // if property is missing, use the type information
        if (!('base' in canonicalAnnotation)) {
            if (typestr.startsWith('Measure')) {
                const base = func.name.toLowerCase();
                canonicalAnnotation['base'] = [base];
                canonicalAnnotation['property'] = [base];
            }
        }

        // if property is missing, use the type information
        if (!('property' in canonicalAnnotation)) {
            const base = utils.clean(typestr.substring(typestr.indexOf(':') + 1));
            canonicalAnnotation['property'] = [base];
            canonicalAnnotation['base'] = [base];
        }

        // if it's the only people entity, adding adjective form
        // E.g., author for review - bob's review
        //       byArtist for MusicRecording - bob's song
        if (typestr.endsWith(':Person'))
            canonicalAnnotation.adjective = ["# 's", '#'];

        // if it's the only date, adding argmin/argmax/base_projection
        if (typestr === 'Date') {
            canonicalAnnotation.adjective_argmax = ["most recent", "latest", "last", "newest"];
            canonicalAnnotation.adjective_argmin = ["earliest", "first", "oldest"];
            canonicalAnnotation.base_projection = ['date'];
        }
    }
    return canonicalAnnotation;
}

export function generateActionExamples(query : Ast.FunctionDef,
                                       arg : Ast.ArgumentDef, 
                                       baseCanonicalAnnotation : CanonicalAnnotation, 
                                       sampleValues : string[]) : ParaphraseExample[] {
    const examples : ParaphraseExample[] = [];
    const queryCanonical = Array.isArray(query.nl_annotations.canonical) ? query.nl_annotations.canonical[0] : query.nl_annotations.canonical;
    for (const [pos, canonicals] of Object.entries(baseCanonicalAnnotation)) {
        if (!PARTS_OF_SPEECH.includes(pos)) 
            continue;
        for (const canonical of canonicals) {
            if (PROJECTION_PARTS_OF_SPEECH.includes(pos)) {
                examples.push(...generateActionExamplesByPOS(query, queryCanonical, arg, canonical, pos));
            } else {
                for (const value of sampleValues) 
                    examples.push(...generateActionExamplesByPOS(query, queryCanonical, arg, canonical, pos, value));
            }
        }    
    }
    return examples;
}

// FIXME: Consider renmaing ParaphraseExample's queryCanonical property so we don't cause confusion here.
function generateActionExamplesByPOS(action : Ast.FunctionDef,
                                     queryCanonical : string,
                                     argument : Ast.ArgumentDef,
                                     argumentCanonical : string,
                                     pos : string, 
                                     value ?: string|boolean) : ParaphraseExample[] {
    function example(utterance : string) : ParaphraseExample {
        return { query: action.name, queryCanonical, argument: argument.name, utterance, value, paraphrases : [] };
    }
    if (!PROJECTION_PARTS_OF_SPEECH.includes(pos)) {
        if (!argumentCanonical.includes('#'))
            argumentCanonical = argumentCanonical + ' #';
    }
    const predicate = typeof value === 'string' ? argumentCanonical.replace('#', value) : argumentCanonical;
    switch (pos) {
    case 'base':
        return [
            example(`${queryCanonical}`),
            example(`${queryCanonical} with the ${argumentCanonical}?`),
        ];
    case 'property':
    case 'property_true':
    case 'property_false':
        return [
            example(`${queryCanonical} with ${predicate}.`),
        ];
    case 'verb':
    case 'verb_true':
    case 'verb_false':
        return [
            example(`${queryCanonical} that ${predicate}.`),
        ];
    case 'passive_verb':
    case 'passive_verb_true':
    case 'passive_verb_false':
    case 'preposition':
    case 'preposition_true':
    case 'preposition_false':
        return [
            example(`${queryCanonical} ${predicate}.`),
        ];
    case 'reverse_property':
    case 'reverse_property_true':
    case 'reverse_property_false':
        return [
            example(`${queryCanonical} ${predicate}?`)
        ];
    case 'adjective':
    case 'adjective_true':
    case 'adjective_false':
        return [
            example(`${queryCanonical} ${predicate} .`),
        ];
    case 'reverse_verb':
        return [
            example(`${queryCanonical} ${predicate}`)
        ];
    default:
        return [];
    }
}

function generateFilterAst(device : string, 
                           func : string, 
                           property : string, 
                           operator : string, 
                           value : any) : Ast.Program {
    const invocation = new Ast.InvocationExpression(
        null, 
        new Ast.Invocation(null, new Ast.DeviceSelector(null, device, null, null), func, [], null),
        null
    );
    const filter = new Ast.AtomBooleanExpression(
        null,
        property, 
        operator, 
        value, // 
        null
    );
    const filtered = new Ast.FilterExpression(
        null, 
        invocation, 
        filter, 
        null
    );
    const statement = new Ast.ExpressionStatement(
        null,
        new Ast.ChainExpression(null, [filtered], null)
    );
    return new Ast.Program(
        null,
        [], 
        [],
        [statement],
        {}
    );
}

function generateProjectionAst(device : string, func : string, property : string) : Ast.Program {
    const invocation = new Ast.InvocationExpression(
        null, 
        new Ast.Invocation(null, new Ast.DeviceSelector(null, device, null, null), func, [], null),
        null
    );
    const projection = new Ast.ProjectionExpression(
        null,
        invocation, 
        [property],
        [], 
        [], 
        null
    );
    const statement = new Ast.ExpressionStatement(
        null,
        new Ast.ChainExpression(null, [projection], null)
    );
    return new Ast.Program(
        null,
        [], 
        [],
        [statement],
        {}
    );
}

function generateActionAst(func : string, property : string, value : any) : Ast.Program {
    const inputParam = new Ast.InputParam(null, property, value);
    const action = new Ast.FunctionCallExpression(
        null,
        func, 
        [inputParam],
        null
    );
    const statement = new Ast.ExpressionStatement(
        null,
        new Ast.ChainExpression(null, [action], null)
    );
    return new Ast.Program(
        null,
        [], 
        [],
        [statement],
        {}
    );
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('sample-synthetic-data', {
        add_help: true,
        description: "Automatically generate samples from the canonicals"
    });
    parser.add_argument('-o', '--output', {
        required: false,
        type: fs.createWriteStream
    });
    parser.add_argument('-l', '--locale', {
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
    });
    parser.add_argument('-c', '--constants', {
        required: false,
        help: 'TSV file containing sampled constant values to be used.'
    });
    parser.add_argument('-t', '--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('-d', '--device', {
        required: true,
        help: `The name of the device to be synthesized.`
    });
    parser.add_argument('-s', '--sampleSize', {
        required: false,
        default: 1,
        help: `The number of samples to be synthesized per annotation.`
    });
    parser.add_argument('-f', '--function', {
        required: false,
        help: `A specific function to be sampled.`
    });
}

export default async function sampler(deviceClass : Ast.ClassDef,
                                      baseTokenizer : I18n.BaseTokenizer,
                                      args : any) {
    const functionNames = Object.keys(deviceClass.queries).concat(Object.keys(deviceClass.actions));
    const sampleMeta = await parseConstantFile(args.locale, args.constants);
    const utteranceThingtalkPairs : NewParaphraseExample[] = [];
    const options = { locale: args.locale, timezone: undefined, includeEntityValue: true };
    for (const fname of functionNames) {
        if (args.function && fname !== args.function)
            continue;
        const func = deviceClass.queries[fname] || deviceClass.actions[fname];
        const typeCounts = countArgTypes(func);
        for (const argDef of func.iterateArguments()) {
            if (argDef.direction !== Ast.ArgDirection.OUT)
                continue;
            if (argDef.name.indexOf('.') >= 0)
                continue;
            const sampleValues = await retrieveSampleValues(deviceClass, sampleMeta, fname, argDef, args.sampleSize);
            const canonicalAnnotation = generateBaseCanonicalAnnotation(func, argDef, typeCounts, functionNames, false);
            let utteranceExamples : ParaphraseExample[];
            if (deviceClass.actions[fname])
                utteranceExamples = generateActionExamples(func, argDef, canonicalAnnotation, sampleValues);
            else
                utteranceExamples = generateQueryExamples(func, argDef, canonicalAnnotation, sampleValues);
            for (const ex of utteranceExamples) {
                const example = ex as NewParaphraseExample;
                const prepUtterance = baseTokenizer.tokenize(example.utterance).tokens.join(' ');
                let program : Ast.Program;
                if (deviceClass.actions[fname]) {
                    if (example.value) {
                        const { value, } = toThingtalkValue(deviceClass, sampleMeta, fname, argDef, `${example.value}`);
                        program = generateActionAst(fname, example.argument, value);
                    } else {
                        continue;
                    }
                } else {
                    if (example.value) {
                        const { value, op } = toThingtalkValue(deviceClass, sampleMeta, fname, argDef, `${example.value}`);
                        program = generateFilterAst(args.device, fname, example.argument, op, value);
                    } else {
                        program = generateProjectionAst(args.device, fname, example.argument);
                    }
                }
                try {
                    const entityDummy = EntityUtils.makeDummyEntities(prepUtterance);
                    example.thingtalk = serializePrediction(program, prepUtterance, entityDummy, options).join(' ');
                } catch(err) {
                    console.log(prepUtterance);
                    console.log(program.prettyprint());
                    console.log(example);
                    throw err;
                }
                example.utterance = prepUtterance.replace(/_/g, ' ');
                utteranceThingtalkPairs.push(example);
            }
        }
    }
    return utteranceThingtalkPairs;
}

export async function execute(args : any) {
    process.stdout.write("Generating samples... ");
    checkOutputPath(args);
    const tpClient = new Tp.FileClient(args);
    const schemaRetriever = new SchemaRetriever(tpClient, null, false);
    const deviceClass = await schemaRetriever.getFullSchema(args.device);
    const baseTokenizer : I18n.BaseTokenizer = I18n.get(args.locale).getTokenizer();
    const utteranceThingtalkPairs = await sampler(deviceClass, baseTokenizer, args);
    const output = toTSV(args.device, utteranceThingtalkPairs, false);
    // console.log(output);
    args.output.write(output);
    process.stdout.write(`Done!\nFile location: ${args.output.path}\n`);
}