// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2018-2020 The Board of Trustees of the Leland Stanford Junior University
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

import assert from 'assert';
import { SchemaRetriever, Builtin } from 'thingtalk';

import CardFormatter from '../../lib/dialogue-agent/card-output/card-formatter';

import _mockSchemaDelegate from './mock_schema_delegate';
const schemaRetriever = new SchemaRetriever(_mockSchemaDelegate, null, true);


const TEST_CASES = [
    ['com.xkcd:get_comic', { number: 1234, title: 'Douglas Engelbart (1925-2013)',
          link: 'https://xkcd.com/1234/',
          picture_url: 'https://imgs.xkcd.com/comics/douglas_engelbart_1925_2013.png',
          alt_text: 'some alt text' },
    [ { type: 'rdl',
        callback: 'https://xkcd.com/1234/',
        webCallback: 'https://xkcd.com/1234/',
        displayTitle: 'Douglas Engelbart (1925-2013)' },
      { type: 'picture',
        url: 'https://imgs.xkcd.com/comics/douglas_engelbart_1925_2013.png' },
      { type: 'text',
        text: 'some alt text' } ]
    ],

    ['org.thingpedia.weather:current',
        { location: new Builtin.Location(37, -113, "Somewhere"),
          temperature: 21,
          wind_speed: 5,
          humidity: 60,
          cloudiness: 0,
          fog: 0,
          status: 'sunny',
          icon: 'http://example.com/sunny.png'
        },
    [{ type: 'text',
        text: 'Current weather for Somewhere: sunny, temperature 21 C, wind speed 5 m/s, humidity 60%, cloudiness 0%, fog 0%.' }]
    ],

    ['org.thingpedia.weather:current',
        { location: new Builtin.Location(37, -113, "Somewhere"),
          temperature: 21,
          wind_speed: 5,
          humidity: 60,
          cloudiness: 0,
          fog: 0,
          status: 'sunny',
          icon: 'http://example.com/sunny.png'
        },
    [{ type: 'text',
        text: 'Current weather for Somewhere: sunny, temperature 21 C, wind speed 5 m/s, humidity 60%, cloudiness 0%, fog 0%.'}]
    ],

    ['org.thingpedia.builtin.thingengine.builtin:get_time',
      {time: new Date(2018, 4, 24, 11, 4, 0) },
    [{ type: 'text',
        text:  'Current time is 11:04:00 AM PDT.' }]
    ],

    ['org.thingpedia.builtin.thingengine.builtin:get_date',
      {date: new Date(2018, 4, 24, 11, 4, 0) },
    [{ type: 'text',
        text:  'Today is Thursday, May 24, 2018.' }]
    ],

    ['com.wikicfp:search', {
        start: new Date('TBD'),
        end: new Date('TBD'),
        deadline: new Date(2019, 2,4 ),
        link: 'http://www.abc.com',
        name: 'Some Computer Conference',
        abbr: 'SCC',
        city: 'North Pole'
    },
    [ { type: 'rdl',
        callback: 'http://www.abc.com',
        webCallback: 'http://www.abc.com',
        displayTitle: 'Some Computer Conference (SCC)',
        displayText: 'Where: North Pole,\nWhen: N/A - N/A,\nDeadline: Monday, March 4, 2019.' } ]
    ],


    // when all parameters are undefined/null, do not include the output
    ['org.thingpedia.weather:current',
        { location: undefined,
            temperature: undefined,
            wind_speed: null,
            humidity: null,
            cloudiness: undefined,
            fog: undefined,
            status: undefined,
            icon: undefined,
        },
        [ ]
    ],

    // when displayTitle and displayText are missing, only return a link
    ['com.wikicfp:search', {
        start: new Date('TBD'),
        end: new Date('TBD'),
        deadline: new Date('TBD'),
        link: 'http://www.abc.com',
        name: undefined,
        abbr: undefined,
        city: undefined
    },
    [ { type: 'rdl',
        callback: 'http://www.abc.com',
        webCallback: 'http://www.abc.com',
        displayTitle: 'http://www.abc.com',
        displayText: null } ]
    ],
];

const formatter = new CardFormatter('en-US', 'America/Los_Angeles', schemaRetriever);

async function test(i) {
    console.log('Test Case #' + (i+1));

    let [outputType, outputValues, expected] = TEST_CASES[i];

    try {
        const generated = await formatter.formatForType(outputType, outputValues);
        try {
            assert.strictEqual(JSON.stringify(generated), JSON.stringify(expected));
        } catch(e) {
            console.log(generated);
            throw e;
        }
    } catch(e) {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
        console.error(e.stack);
        if (process.env.TEST_MODE)
            throw e;
    }
}

export default async function main() {
    for (let i = 0; i < TEST_CASES.length; i++)
        await test(i);
}
if (!module.parent)
    main();
