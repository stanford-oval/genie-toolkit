// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2018 Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const TpClient = require('thingpedia-client');

const { getBestEntityMatch } = require('../lib/dialogs/entity_lookup');

const THINGPEDIA_URL = 'https://almond-dev.stanford.edu/thingpedia';

const _mockPlatform = {
    locale: 'en-US',
    getDeveloperKey() {
        return null;
    }
};
const _thingpediaClient = new TpClient.HttpClient(_mockPlatform, THINGPEDIA_URL);


const TEST_CASES = [
    ['tt:cryptocurrency_code', 'bitcoin', 'btc', 'Bitcoin'],
    ['tt:cryptocurrency_code', 'bitcoin cash', 'bch', 'Bitcoin Cash'],
    ['tt:cryptocurrency_code', 'ethereum', 'eth', 'Ethereum'],

    ['sportradar:eu_soccer_team', 'juventus', 'juv', 'Juventus Turin'],
    ['sportradar:eu_soccer_team', 'inter', 'int', 'Inter Milan'],
    ['sportradar:eu_soccer_team', 'arsenal', 'ars', 'Arsenal FC'],
    ['sportradar:eu_soccer_team', 'barcelona', 'bar', 'FC Barcelona'],

    ['sportradar:us_soccer_team', 'san jose earthquakes', 'sje', "San Jose Earthquakes"],
    ['sportradar:us_soccer_team', 'sj earthquakes', 'sje', "San Jose Earthquakes"],

    ['sportradar:ncaafb_team', 'stanford cardinals', 'sta', 'Stanford Cardinal'],
    ['sportradar:ncaafb_team', 'stanford cardinal', 'sta', 'Stanford Cardinal'],
    ['sportradar:ncaafb_team', 'stanford', 'sta', 'Stanford Cardinal'],
    ['sportradar:ncaafb_team', 'california bears', 'cal', 'California Bears'],
    ['sportradar:ncaafb_team', 'cal bears', 'cal', 'California Bears'],

    ['sportradar:ncaambb_team', 'stanford cardinals', 'stan', 'Stanford Cardinal'],
    ['sportradar:ncaambb_team', 'stanford cardinal', 'stan', 'Stanford Cardinal'],
    ['sportradar:ncaambb_team', 'stanford', 'stan', 'Stanford Cardinal'],

    ['sportradar:nba_team', 'golden state warriors', 'gsw', 'Golden State Warriors'],
    ['sportradar:nba_team', 'warriors', 'gsw', 'Golden State Warriors'],
    ['sportradar:nba_team', 'los angeles lakers', 'lal', 'Los Angeles Lakers'],
    ['sportradar:nba_team', 'la lakers', 'lal', 'Los Angeles Lakers'],
    ['sportradar:nba_team', 'cleveland cavaliers', 'cle', 'Cleveland Cavaliers'],
    ['sportradar:nba_team', 'cavaliers', 'cle', 'Cleveland Cavaliers'],

    ['tt:country', 'usa', 'us', 'United States of America'],
    ['tt:country', 'us', 'us', 'United States of America'],
    ['tt:country', 'america', 'us', 'United States of America'],
    ['tt:country', 'italy', 'it', 'Italy'],

    ['com.instagram:filter', 'sierra', 'sierra', 'Sierra'],
    ['com.instagram:filter', 'lo-fi', 'lo-fi', 'Lo-Fi'],

    ['gov.nasa:curiosity_rover_camera', 'front camera', 'FHAZ', 'Front Hazard Avoidance Camera'],

    ['imgflip:meme_id', 'futurama fry', '61520', 'Futurama Fry'],
    ['imgflip:meme_id', 'brace yourselves', '61546', 'Brace Yourselves X is Coming'],
    ['imgflip:meme_id', 'brace yourself', '61546', 'Brace Yourselves X is Coming'],
    ['imgflip:meme_id', 'brace yourself winter is coming', '61546', 'Brace Yourselves X is Coming'],
    ['imgflip:meme_id', 'y u no', '61527', 'Y U No'],
    ['imgflip:meme_id', 'why you no', '61527', 'Y U No'],
    ['imgflip:meme_id', 'shut up and take my money', '176908' ,'Shut Up And Take My Money Fry'],
    ['imgflip:meme_id', 'socially awesome penguin', '61584', 'Socially Awesome Awkward Penguin'],
    ['imgflip:meme_id', 'all the things', '61533', 'X All The Y'],
    ['imgflip:meme_id', 'x all the things', '61533', 'X All The Y']
];

async function main() {
    let failed = false;

    for (let i = 0; i < TEST_CASES.length; i++) {
        let [entityType, searchTerm, expectedValue, expectedDisplay] = TEST_CASES[i];
        const {data:candidates} = await _thingpediaClient.lookupEntity(entityType, searchTerm);

        if (candidates.length === 0) {
            if (expectedValue === null && expectedDisplay === 0)
                continue;
            console.error(`Test Case ${i+1} failed`);
            console.error(`Expected: ${expectedValue}("${expectedDisplay}")`);
            console.error(`Generated: null`);
            failed = true;
        } else {
            const best = getBestEntityMatch(searchTerm, candidates);

            if (expectedValue === null && expectedDisplay === 0) {
                console.error(`Test Case ${i+1} failed`);
                console.error(`Expected: null`);
                console.error(`Generated: ${best.value}("${best.name}")`);
                failed = true;
            } else if (best.value !== expectedValue || best.name !== expectedDisplay) {
                console.error(`Test Case ${i+1} failed`);
                console.error(`Expected: ${expectedValue}("${expectedDisplay}")`);
                console.error(`Generated: ${best.value}("${best.name}")`);
                failed = true;
            }
        }
    }

    if (failed)
        throw new Error('testEntities FAILED');
}
if (module.parent)
    module.exports = main;
else
    main();
