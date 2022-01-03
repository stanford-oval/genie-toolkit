// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

import assert from 'assert';
import EnglishLanguagePack from "../../lib/i18n/english";

const today = new Date;
today.setHours(0, 0, 0);
const tomorrow = new Date(today.getTime() + 86400000);
const nextweek = new Date(today);
nextweek.setDate(nextweek.getDate() - nextweek.getDay() + 7);

const preciseDate1 = new Date(today.getFullYear(), 5, 7, 0, 0, 0);
const preciseDate2 = new Date(today.getFullYear(), 5, 7, 11, 0, 0);

const TEST_CASES = [
    ['it will be cloudy on DATE_0 in LOCATION_0 .', {
        DATE_0: today,
        LOCATION_0: { display: 'Redwood City, California' }
    },
    'It will be cloudy today in Redwood City, California.'],

    ['it will be cloudy on DATE_0 in LOCATION_0 .', {
        DATE_0: tomorrow,
        LOCATION_0: { display: 'Redwood City, California' }
    },
    'It will be cloudy tomorrow in Redwood City, California.'],

    ['it will be cloudy on DATE_0 in LOCATION_0 .', {
        DATE_0: nextweek,
        LOCATION_0: { display: 'Redwood City, California' }
    },
    'It will be cloudy on Sunday in Redwood City, California.'],

    ['it will be cloudy on DATE_0 in LOCATION_0 .', {
        DATE_0: preciseDate1,
        LOCATION_0: { display: 'Redwood City, California' }
    },
    'It will be cloudy on June 7 in Redwood City, California.'],

    ['it will be cloudy on DATE_0 in LOCATION_0 .', {
        DATE_0: preciseDate2,
        LOCATION_0: { display: 'Redwood City, California' }
    },
    'It will be cloudy on June 7 at 11:00 AM in Redwood City, California.'],
];

const langPack = new EnglishLanguagePack('en-US');
const unitDelegate = {
    timezone: 'America/Los_Angeles',
    getPreferredUnit() {
        return 'F';
    }
};

function test(i) {
    console.log(`# Test Case ${i+1}`);

    const [input, entities, expected] = TEST_CASES[i];
    const generated = langPack.postprocessNLG(input, entities, unitDelegate);

    assert.strictEqual(generated, expected);
}

export default async function main() {
    for (let i = 0; i < TEST_CASES.length; i++)
        test(i);
}
if (!module.parent)
    main();
