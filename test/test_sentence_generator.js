#!/usr/bin/env node
// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

process.on('unhandledRejection', (up) => { throw up; });

const path = require('path');
const stream = require('stream');
const seedrandom = require('seedrandom');

const { BasicSentenceGenerator } = require('../lib/sentence-generator');

const ThingTalk = require('thingtalk');
const NNSyntax = ThingTalk.NNSyntax;
const SchemaRetriever = ThingTalk.SchemaRetriever;

const _tpClient = require('./mock_schema_delegate');
const _schemaRetriever = new SchemaRetriever(_tpClient, null, true);

const VALUES = {
    QUOTED_STRING: ["i'm happy", "you would never believe what happened", "merry christmas", "love you"],

    NUMBER: [42, 7, 14, 11, 55],

    MEASURE: {
        'F': [73, 75, 80],
        'C': [20, 21, 17],

        'byte': [500, 1500],
        'KB': [300],
        'MB': [15, 40],
        'GB': [2, 3],
        'TB': [1.5, 2],

        'kg': [75, 81, 88],
        'lb': [150, 180, 239],
        'g': [500, 1500],
        'oz': [12, 15],

        'm': [500, 1500],
        'km': [23, 50],
        'mi': [30, 200],
        'ft': [6, 100, 800],
        'in': [2, 4],
        'cm': [5, 3],

        'kmph': [70, 120],
        'mph': [35, 60],
        'mps': [12, 14],
    },
    CURRENCY: [
        ['$100', { value: 100, unit: 'usd' }],
        ['15 dollars', { value: 15, unit: 'usd' }],
        ['$ 3.50', { value: 3.5, unit: 'usd' }]
    ],
    DURATION: [
        ['two hours', { value: 2, unit: 'h'}],
        ['30 minutes', { value: 30, unit: 'min' }],
        ['3 days', { value: 3, unit: 'day' }]
    ],

    LOCATION: [
        ['Palo Alto, California', { latitude: 37.442156, longitude: -122.1634471 }],
        ['Los Angeles, California', { latitude: 34.0543942, longitude: -118.2439408 }]
    ],

    DATE: [
        ['Feb 14 2017', new Date('2017-02-14T00:00:00-08:00')],
        ['May 4th, 2016', new Date('2016-05-04T00:00:00-07:00')],
        ['August 2nd 2017', new Date('2017-08-02T00:00:00-07:00')],
    ],

    TIME: [
        ['7:30 am', { hour: 7, minute: 30, second: 0 }],
        ['3 pm', { hour: 15, minute: 0, second: 0 }],
        ['8:30 pm', { hour: 20, minute: 30, second: 0 }]
    ],

    EMAIL_ADDRESS: ['bob@gmail.com', 'alice@gmail.com', 'charlie@hotmail.com'],
    PHONE_NUMBER: ['+16501234567', '+15551234567', '+123456789'],
    HASHTAG: [
        ['#funny', 'funny'], ['#cat', 'cat'], ['#lol', 'lol'],
        ['#covfefe', 'covfefe']
    ],
    USERNAME: [['@alice', 'alice'], ['@bob', 'bob'], ['@charlie', 'charlie']],
    URL: [
        'http://www.abc.def',
        ['www.google.com', 'http://www.google.com'],
        'http://www.example.com'
    ],
    PATH_NAME: [
        'images/lol.png',
        'images/me.png',
        'documents/work.pdf',
        'videos/cat.mp4',
        'school/cs101/hw1.pdf'
    ],

    'GENERIC_ENTITY_tt:stock_id':
        [["Google", 'goog'], ["Apple", 'aapl'], ['Microsoft', 'msft'], ['Walmart', 'wmt']],
    'GENERIC_ENTITY_tt:iso_lang_code':
        [["Italian", 'it'], ["German", 'de'], ["Chinese", 'zh'], ['Spanish', 'es']],
    'GENERIC_ENTITY_sportradar:eu_soccer_team':
        [["Juventus", "juv"], ["Barcelona", "bar"], ["Bayern Munich", "fcb"], ["Chelsea", 'che']],
    'GENERIC_ENTITY_sportradar:mlb_team':
        [["SF Giants", 'sf'], ["Chicago Cubs", 'chc']],
    'GENERIC_ENTITY_sportradar:nba_team':
        [["Golden State Warriors", 'gsw'], ["LA Lakers", 'lal']],
    'GENERIC_ENTITY_sportradar:ncaafb_team':
        [["Stanford Cardinals", 'sta'], ["California Bears", 'cal']],
    'GENERIC_ENTITY_sportradar:ncaambb_team':
        [["Stanford Cardinals", 'stan'], ["California Bears", 'cal']],
    'GENERIC_ENTITY_sportradar:nfl_team':
        [["Seattle Seahawks", 'sea'], ["SF 49ers", 'sf']],
    'GENERIC_ENTITY_sportradar:us_soccer_team':
        [["San Jose Earthquakes", 'sje'], ["Toronto FC", 'tor']],
    'GENERIC_ENTITY_tt:mime_type': [
        ['PDF documents', 'application/pdf'],
        ['JPEG pictures', 'image/jpeg'],
        ['Word documents', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        ['Excel spreadsheets', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    ],
    'GENERIC_ENTITY_tt:country': [
        ['United States', 'us'],
        ['Italy', 'it'],
        ['UK', 'gb'],
        ['Germany', 'de']
    ],
    'GENERIC_ENTITY_gov.nasa:curiosity_rover_camera': [
        ['Mast Camera', 'MAST'],
        ['Front Hazard Avoidance Camera', 'FHAZ'],
        ['Mars Hand Lens Imager', 'MAHLI']
    ],
    'GENERIC_ENTITY_imgflip:meme_id': [
        ['Futurama Fry', '61520'],
        ['Brace Yourselves', '61546']
    ],
    'GENERIC_ENTITY_com.instagram:filter': [
        ['Inkwell', 'inkwell'],
        ['Lo-Fi', 'lo-fi'],
        ['Sierra', 'sierra']
    ],
};

class UnassignableEntity extends Error {}

function quote(qs) {
    return [`"${qs}"`, qs];
}

async function processOne(id, sentence, code) {
    const assignedEntities = {};
    const usedValues = new Set;

    function entityRetriever(entity, param, functionname, unit) {
        if (assignedEntities[entity])
            return assignedEntities[entity].value;

        const underscoreindex = entity.lastIndexOf('_');
        const entitytype = entity.substring(0, underscoreindex);

        let choices;
        if (entitytype === 'PATH_NAME' && (param === 'repo_name' || param === 'folder_name')) {
            choices = [];
        } else if (entitytype === 'GENERIC_ENTITY_tt:iso_lang_code' && param === 'source_language') {
            choices = [["English", 'en']];
        } else if (entitytype === 'NUMBER' && !!unit) {
            choices = VALUES.MEASURE[unit];
            if (!choices)
                throw new Error('Invalid unit ' + unit);
        } else if (entitytype === 'QUOTED_STRING') {
            choices = VALUES.QUOTED_STRING.map(quote);
        } else if (entitytype === 'NUMBER' && param === 'temperature') {
            throw new Error('??? ' + param + ' ' + unit);
        } else {
            choices = VALUES[entitytype];
            if (!choices)
                throw new Error('unrecognized entity type ' + entitytype);
        }
        choices = choices.map((c) => {
            if (typeof c === 'string' || typeof c === 'number')
                return [String(c), c];
            else
                return c;
        });

        //let index = parseInt(entity.substring(underscoreindex+1));
        if (choices.length > 0) {
            for (let i = 0; i < choices.length; i++) {
                let [display, value] = choices[i];

                /*if (entitytype === 'NUMBER' && assignedEntities['NUMBER_' + (index-1)] && assignedEntities['NUMBER_' + (index-1)].value >= value)
                    continue;
                if (entitytype === 'NUMBER' && assignedEntities['NUMBER_' + (index+1)] && assignedEntities['NUMBER_' + (index+1)].value <= value)
                    continue;*/
                if (!usedValues.has(value)) {
                    assignedEntities[entity] = { display, value };
                    usedValues.add(value);
                    if (entitytype.startsWith('GENERIC_ENTITY_'))
                        return { display, value };
                    else
                        return value;
                }
            }
        }

        console.log(choices, usedValues);
        throw new UnassignableEntity(`Run out of values for ${entity} (unit ${unit}, param name ${param})`);
    }

    const program = NNSyntax.fromNN(code.split(' '), entityRetriever);
    await program.typecheck(_schemaRetriever);

    const usedEntities = new Set;
    for (let token of sentence.split(' ')) {
        if (/^[A-Z]/.test(token)) { // entity
            if (!assignedEntities[token])
                throw new Error(`Missing entity ${token} (present in the sentence, not in the code)`);
            usedEntities.add(token);
        }
    }

    for (let token in assignedEntities) {
        if (!usedEntities.has(token))
            throw new Error(`Missing entity ${token} (present in the code, not in the sentence)`);
    }
}

async function main() {
    const options = {
        rng: seedrandom.alea('almond is awesome'),
        locale: 'en-US',
        templateFile: path.resolve(path.dirname(module.filename), '../languages/en/thingtalk.genie'),
        thingpediaClient: _tpClient,
        flags: {
            turking: false,
            remote_programs: true,
            policies: true,
            aggregation: true,
            bookkeeping: true,
            triple_commands: true,
            undefined_filter: true,
            timer: true,
            projection: false,
            projection_with_filter: false,
            wikidata: false
        },
        maxDepth: 6,
        debug: true
    };

    const generator = new BasicSentenceGenerator(options);
    const writer = new stream.Writable({
        objectMode: true,

        write(ex, encoding, callback) {
            Promise.resolve().then(() => {
                return processOne(ex.id, ex.preprocessed, ex.target_code);
            }).then(() => {
                callback(null);
            }, (e) => {
                callback(e);
            });
        },

        flush(callback) {
            process.nextTick(callback);
        }
    });
    generator.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}
module.exports = main;
if (!module.parent)
    main();
