// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017-2020 The Board of Trustees of the Leland Stanford Junior University
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

import assert from 'assert';
import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';
import * as I18n from '../../lib/i18n';
import * as Path from 'path';
import sampler from '../../tool/sample-synthetic-data';
import { ArgumentParser } from 'argparse';
// const Type = ThingTalk.Type;

const TEST_CASES = [

    // query, type, utterance, thingtalk 
    ['setting', 'enum', 'what is the status of the setting ?', '[ state ] of @mock.device . setting ( ) ;'],
    ['setting', 'enum', `which setting has status {0} ?`, '@mock.device . setting ( ) filter state == enum {0} ;'],
    ['person', 'string', 'what is the name of the person ?', '[ name ] of @mock.device . person ( ) ;'],
    ['machine', 'measure', 'what is the speed of the machine ?', '[ speed ] of @mock.device . machine ( ) ;'],
    ['machine', 'measure', 'which machine has speed {0} metre per second ?', '@mock.device . machine ( ) filter speed == {0} mps ;'],
    ['website', 'entity', "what is the website 's link ?", '[ url ] of @mock.device . website ( ) ;'],
    ['packages', 'array', 'what items does the packages have ?', '[ fruits ] of @mock.device . packages ( ) ;'],
    ['base_station', 'location', 'what is the location of the base station ?', '[ geo ] of @mock.device . base_station ( ) ;'],
    ['base_station', 'location', 'show me a base station with location {0} .', '@mock.device . base_station ( ) filter geo == new Location({0}) ;'],
    ['contact', 'entity', "what phone number does the customer support have ?", '[ phone ] of @mock.device . contact ( ) ;']
];

String.prototype.format = function() {
    const args = arguments;
    return this.replace(/{([0-9]+)}/g, (match, index) => {
        return typeof args[index] === 'undefined' ? match : args[index];
    });
};

function initArgparse() {
    const parser = new ArgumentParser({
        description: 'Unit test synthetic data sampler argparser',
        add_help: true
    });
    parser.add_argument('-l', '--locale', {
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
    });
    parser.add_argument('-c', '--constants', {
        required: false,
        default: Path.resolve(Path.dirname(module.filename), '../data/en-US/mock-thingpedia/constants.tsv'),
        help: 'TSV file containing sampled constant values to be used.'
    });
    parser.add_argument('-d', '--device', {
        required: false,
        default: 'mock.device',
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
    return parser;
}

export default async function main() {
    let anyFailed = false;
    const parser = initArgparse();
    const args = parser.parse_args();
    const tpClient = new Tp.FileClient({
        locale: 'en',
        thingpedia: Path.resolve(Path.dirname(module.filename), '../data/en-US/mock-thingpedia/mock.device/manifest.tt')
    });
    const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, true);
    const deviceClass = await schemaRetriever.getFullSchema(args.device);
    const baseTokenizer = I18n.get(args.locale).getTokenizer();
    for (let [query, type, utterance, thingtalk] of TEST_CASES) {
        args.function = query;
        const ret = await sampler(tpClient, deviceClass, baseTokenizer, args);
        const item = ret.filter((x) => {
            if (x.value !== undefined)
                utterance = utterance.format(x.value);
            return x.utterance.toLowerCase() === utterance.toLowerCase();
        });
        try {
            assert(item.length === 1);
            if (item[0].value !== undefined) {
                utterance = utterance.format(item[0].value);
                if (type === 'location') {
                    const regExp = /Location\s?\(([^)]+)\)/gi;
                    const matches = regExp.exec(item[0].thingtalk);
                    thingtalk = thingtalk.format(matches[1]);
                } else {
                    thingtalk = thingtalk.format(item[0].value);
                }
            }
            assert.deepStrictEqual(item[0].query, query);
            assert.deepStrictEqual(item[0].utterance.toLowerCase(), utterance.toLowerCase());
            assert.deepStrictEqual(item[0].thingtalk.toLowerCase(), thingtalk.toLowerCase());
        } catch(e) {
            console.error(`Test case "${query}" failed`);
            console.error(`${item[0].utterance} :: ${utterance}`);
            console.error(`${item[0].thingtalk} :: ${thingtalk}`);
            console.error(e);
            anyFailed = true;
        }
    }
    if (anyFailed)
        throw new Error('Some test failed');
    else
        process.stdout.write('{0}/{1} Passed!\n'.format(TEST_CASES.length, TEST_CASES.length));
}

if (!module.parent)
    main();
