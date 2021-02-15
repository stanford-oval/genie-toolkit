// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2018 Google LLC
//           2018-2020 The Board of Trustees of the Leland Stanford Junior University
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
import { Ast, Syntax }  from 'thingtalk';
import { Describer } from '../../lib/utils/thingtalk/describe';

async function testDescribeArg() {
    const allocator = new Syntax.SequentialEntityAllocator({});
    const describer = new Describer('en-US', 'America/Los_Angeles', allocator);
    const describer2 = new Describer('en-US', 'Asia/Tokyo', allocator);
    const describer3 = new Describer('en-US', 'Pacific/Honolulu', allocator);
    // we would like to test i18n here too but
    // travis's nodejs does not have full-icu so Intl is
    // broken (also on Android)

    const TEST_CASES = [
        [new Ast.Value.VarRef('picture_url'), 'the image'],
        [new Ast.Value.VarRef('argument'), 'the argument'],
        [new Ast.Value.VarRef('other_argument'), 'the other argument'],
        [new Ast.Value.Undefined(true), '____'],
        [new Ast.Value.Undefined(false), '____'],

        [new Ast.Value.Boolean(true), 'true'],
        [new Ast.Value.Boolean(false), 'false'],

        [new Ast.Value.String('some string'), `QUOTED_STRING_0`],
        [new Ast.Value.String('some string with "'), `QUOTED_STRING_1`],

        [new Ast.Value.Measure(21, 'C'), 'MEASURE_C_0'],
        [new Ast.Value.Measure(21, 'kmph'), 'MEASURE_mps_0'],
        [new Ast.Value.Computation('+',
            [new Ast.Value.Measure(6, 'ft'),
             new Ast.Value.Measure(4, 'in')]),
         `MEASURE_m_0 MEASURE_m_1`],
        [new Ast.Value.Number(4.0), `NUMBER_0`],
        [new Ast.Value.Number(4.5), `NUMBER_1`],
        [new Ast.Value.Number(1e+23), `NUMBER_2`],

        // U+OOAO NO-BREAK SPACE
        [new Ast.Value.Currency(1000, 'usd'), 'CURRENCY_0'],
        [new Ast.Value.Currency(1000.001, 'usd'), 'CURRENCY_1'],
        [new Ast.Value.Currency(1000.005, 'usd'), 'CURRENCY_2'],
        [new Ast.Value.Currency(1000.99, 'usd'), 'CURRENCY_3'],
        [new Ast.Value.Currency(1000.995, 'usd'), 'CURRENCY_4'],
        [new Ast.Value.Currency(1000, 'eur'), 'CURRENCY_5'],

        [new Ast.Value.Location(new Ast.Location.Relative('home')), `home`],
        [new Ast.Value.Location(new Ast.Location.Relative('work')), `work`],
        [new Ast.Value.Location(new Ast.Location.Relative('current_location')), `here`],
        [new Ast.Value.Location(new Ast.Location.Absolute(0, 0, 'North Pole')), `LOCATION_0`],
        [new Ast.Value.Location(new Ast.Location.Absolute(0, 0, null)), `LOCATION_0`],

        [new Ast.Value.Time(new Ast.Time.Relative('morning')), 'the morning'],
        [new Ast.Value.Time(new Ast.Time.Relative('evening')), 'the evening'],

        [new Ast.Value.Entity('foo', 'tt:foo', 'Some Entity'), 'GENERIC_ENTITY_tt:foo_0'],

    ];

    for (let [value, expected] of TEST_CASES) {
        assert.strictEqual(describer.describeArg(value, { picture_url: 'image' }), expected);
        if (!value.isVarRef)
            assert.strictEqual(describer.describeArg(value), expected);
    }

    const date = new Ast.Value.Date(new Date(2018, 9, 13, 0, 0, 0));

    assert.strictEqual(describer.describeArg(date), 'DATE_0');
    assert.strictEqual(describer2.describeArg(date), 'DATE_0');
    assert.strictEqual(describer3.describeArg(date), 'DATE_0');

    const date2 = new Ast.Value.Date(new Date(2018, 9, 13, 1, 0, 0));
    assert.strictEqual(describer.describeArg(date2), 'DATE_1');
    assert.strictEqual(describer2.describeArg(date2), 'DATE_1');
    assert.strictEqual(describer3.describeArg(date2), 'DATE_1');
}

export default async function main() {
    await testDescribeArg();
}
if (!module.parent)
    main();
