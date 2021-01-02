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
import { Ast }  from 'thingtalk';
import { Describer } from '../../lib/utils/thingtalk/describe';

const gettext = {
    locale: 'en-US',
    dgettext: (domain, msgid) => msgid,
    dngettext: (domain, msgid, msgid_plural, n) => n === 1 ? msgid : msgid_plural,
};

async function testDescribeArg() {
    const describer = new Describer(gettext, 'en-US', 'America/Los_Angeles');
    const describer2 = new Describer(gettext, 'en-US', 'Asia/Tokyo');
    const describer3 = new Describer(gettext, 'en-US', 'Pacific/Honolulu');
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

        [new Ast.Value.String('some string'), `“some string”`],
        [new Ast.Value.String('some string with "'), `“some string with "”`], //"

        [new Ast.Value.Measure(21, 'C'), `21 C`],
        [new Ast.Value.Measure(21, 'kmph'), `21 kmph`],
        [new Ast.Value.Computation('+',
            [new Ast.Value.Measure(6, 'ft'),
             new Ast.Value.Measure(4, 'in')]),
         `6 ft 4 in`],
        [new Ast.Value.Number(4.0), `4`],
        [new Ast.Value.Number(4.5), `4.5`],
        [new Ast.Value.Number(1e+23), `100,000,000,000,000,000,000,000`],

        // U+OOAO NO-BREAK SPACE
        [new Ast.Value.Currency(1000, 'usd'), '$1,000.00'],
        [new Ast.Value.Currency(1000.001, 'usd'), '$1,000.00'],
        [new Ast.Value.Currency(1000.005, 'usd'), '$1,000.01'],
        [new Ast.Value.Currency(1000.99, 'usd'), '$1,000.99'],
        [new Ast.Value.Currency(1000.995, 'usd'), '$1,001.00'],
        [new Ast.Value.Currency(1000, 'eur'), '€1,000.00'],

        [new Ast.Value.Location(new Ast.Location.Relative('home')), `at home`],
        [new Ast.Value.Location(new Ast.Location.Relative('work')), `at work`],
        [new Ast.Value.Location(new Ast.Location.Relative('current_location')), `here`],
        [new Ast.Value.Location(new Ast.Location.Absolute(0, 0, 'North Pole')), `North Pole`],
        [new Ast.Value.Location(new Ast.Location.Absolute(0, 0, null)), `[Latitude: 0 deg, Longitude: 0 deg]`],

        [new Ast.Value.Time(new Ast.Time.Relative('morning')), 'the morning'],
        [new Ast.Value.Time(new Ast.Time.Relative('evening')), 'the evening'],

        [new Ast.Value.Entity('foo', 'tt:foo', 'Some Entity'), 'Some Entity'],

    ];

    for (let [value, expected] of TEST_CASES) {
        assert.strictEqual(describer.describeArg(value, { picture_url: 'image' }), expected);
        if (!value.isVarRef)
            assert.strictEqual(describer.describeArg(value), expected);
    }

    const date = new Ast.Value.Date(new Date(2018, 9, 13, 0, 0, 0));

    assert.strictEqual(describer.describeArg(date), 'Saturday, October 13, 2018');
    assert.strictEqual(describer2.describeArg(date), 'Saturday, October 13, 2018');
    assert.strictEqual(describer3.describeArg(date), 'Friday, October 12, 2018');

    const date2 = new Ast.Value.Date(new Date(2018, 9, 13, 1, 0, 0));
    assert.strictEqual(describer.describeArg(date2), '10/13/2018, 1:00:00 AM');
    assert.strictEqual(describer2.describeArg(date2), '10/13/2018, 5:00:00 PM');
    assert.strictEqual(describer3.describeArg(date2), '10/12/2018, 10:00:00 PM');
}

export default async function main() {
    await testDescribeArg();
}
if (!module.parent)
    main();
