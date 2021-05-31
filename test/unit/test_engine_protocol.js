// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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
import * as Tp from 'thingpedia';

import * as protocol from '../../lib/engine/sync/protocol';

const TEST_CASES = [
    // primitives
    [{ a: 1, b: 'str', c: '', d: null, e: true, f: false },
    `a=1:b=str:c=:d=:e=true:f=false`,
    { a: 1, b: 'str', c: '', d: null, e: true, f: false }
    ],

    // nesting
    [{ a: [1, 2, 3], b: ['a', 'b', 'c'] },
    `a=[1,2,3]:b=[a,b,c]`,
    { a: [1, 2, 3], b: ['a', 'b', 'c'] }
    ],

    // complex
    [{
        a: new Date('2020-01-01T00:00:00Z'),
        b: new Tp.Value.Currency(1000, 'usd'),
        c: new Tp.Value.Entity('foo', null),
        d: new Tp.Value.Entity('bar', 'Bar description'),
        e: new Tp.Value.Time(19, 30, 0),
        f: new Tp.Value.Location(90, 0),
        g: new Tp.Value.Location(90, 0, 'North Pole'),
    },
    `a=1577836800000:b=1000 USD:c=foo:d=bar:e=19:30:f=[Latitude: 90.00000 deg, Longitude: 0.00000 deg]:g=North Pole`,
    {
        a: { tag: 'date', v: 1577836800000 },
        b: { tag: 'currency', v: 1000, c: 'usd' },
        c: { tag: 'entity', v: 'foo', d: null },
        d: { tag: 'entity', v: 'bar', d: 'Bar description' },
        e: { tag: 'time', h: 19, m: 30, s: 0 },
        f: { tag: 'loc', x: 0, y: 90, d: null },
        g: { tag: 'loc', x: 0, y: 90, d: 'North Pole' },
    }
    ],
];

function test(i) {
    console.log(`Test case # ${i+1}`);

    const [input, expectedString, expectedWire] = TEST_CASES[i];

    assert.deepStrictEqual(protocol.params.makeString(input), expectedString);
    assert.deepStrictEqual(protocol.params.marshal(input), expectedWire);
    assert.deepStrictEqual(protocol.params.unmarshal(expectedWire), input);
}

async function main() {
    for (let i = 0; i < TEST_CASES.length; i++)
        await test(i);
}
export default main;
if (!module.parent)
    main();
