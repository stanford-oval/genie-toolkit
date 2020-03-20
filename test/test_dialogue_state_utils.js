// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');

const { computeNewState, } = require('../lib/dialogue_state_utils');

const _mockThingpediaClient = require('./mock_schema_delegate');
const schemas = new ThingTalk.SchemaRetriever(_mockThingpediaClient, null, true);

const TEST_CASES = [
    [
`$dialogue @org.thingpedia.dialogue.transaction.sys_recommend_one;
now => (@com.yelp(id="com.yelp").restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) => notify
#[results=[
  { id="r6RztnVjcMq8wqI8o9ra_A"^^com.yelp:restaurant("Reposado"), link="https://www.yelp.com/biz/reposado-palo-alto?adjust_creative=hejPBQRox5iXtqGPiDw4dg&utm_campaign=yelp_api_v3&utm_medium=api_v3_business_search&utm_source=hejPBQRox5iXtqGPiDw4dg"^^tt:url, rating=3.5, cuisines=["mexican"^^com.yelp:restaurant_cuisine("Mexican"), "breakfast_brunch"^^com.yelp:restaurant_cuisine("Breakfast & Brunch")], geo=new Location(37.4441703, -122.1610516, "236 Hamilton Ave, Palo Alto, CA 94301"), image_url="https://s3-media3.fl.yelpcdn.com/bphoto/f4kMLdg1SpQERBdutNcr7w/o.jpg"^^tt:picture },
  { id="_L9p8ZvEmL3fVdjAmPv3NA"^^com.yelp:restaurant("Sancho's Taqueria"), link="https://www.yelp.com/biz/sanchos-taqueria-palo-alto?adjust_creative=hejPBQRox5iXtqGPiDw4dg&utm_campaign=yelp_api_v3&utm_medium=api_v3_business_search&utm_source=hejPBQRox5iXtqGPiDw4dg"^^tt:url, rating=3.5, cuisines=["mexican"^^com.yelp:restaurant_cuisine("Mexican"), "breakfast_brunch"^^com.yelp:restaurant_cuisine("Breakfast & Brunch"), "sandwiches"^^com.yelp:restaurant_cuisine("Sandwiches")], geo=new Location(37.4491, -122.1609, "491 Lytton Ave, Palo Alto, CA 94301"), image_url="https://s3-media4.fl.yelpcdn.com/bphoto/pkjAVBK5wS95Bh8NVycomA/o.jpg"^^tt:picture }
]];
now => [rating] of ((result(@com.yelp.restaurant[1])), id == "r6RztnVjcMq8wqI8o9ra_A"^^com.yelp:restaurant("Reposado")) => notify
#[results=[
  { rating=3.5, id="r6RztnVjcMq8wqI8o9ra_A"^^com.yelp:restaurant("Reposado") }
]];
`,
`$dialogue @org.thingpedia.dialogue.transaction.execute;
now => [reviewCount] of ((result(@com.yelp.restaurant[1])), id == "r6RztnVjcMq8wqI8o9ra_A"^^com.yelp:restaurant("Reposado")) => notify;
`,
`$dialogue @org.thingpedia.dialogue.transaction.execute;
now => (@com.yelp(id="com.yelp").restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) => notify
#[results=[
  { id="r6RztnVjcMq8wqI8o9ra_A"^^com.yelp:restaurant("Reposado"), link="https://www.yelp.com/biz/reposado-palo-alto?adjust_creative=hejPBQRox5iXtqGPiDw4dg&utm_campaign=yelp_api_v3&utm_medium=api_v3_business_search&utm_source=hejPBQRox5iXtqGPiDw4dg"^^tt:url, rating=3.5, cuisines=["mexican"^^com.yelp:restaurant_cuisine("Mexican"), "breakfast_brunch"^^com.yelp:restaurant_cuisine("Breakfast & Brunch")], geo=new Location(37.4441703, -122.1610516, "236 Hamilton Ave, Palo Alto, CA 94301"), image_url="https://s3-media3.fl.yelpcdn.com/bphoto/f4kMLdg1SpQERBdutNcr7w/o.jpg"^^tt:picture },
  { id="_L9p8ZvEmL3fVdjAmPv3NA"^^com.yelp:restaurant("Sancho's Taqueria"), link="https://www.yelp.com/biz/sanchos-taqueria-palo-alto?adjust_creative=hejPBQRox5iXtqGPiDw4dg&utm_campaign=yelp_api_v3&utm_medium=api_v3_business_search&utm_source=hejPBQRox5iXtqGPiDw4dg"^^tt:url, rating=3.5, cuisines=["mexican"^^com.yelp:restaurant_cuisine("Mexican"), "breakfast_brunch"^^com.yelp:restaurant_cuisine("Breakfast & Brunch"), "sandwiches"^^com.yelp:restaurant_cuisine("Sandwiches")], geo=new Location(37.4491, -122.1609, "491 Lytton Ave, Palo Alto, CA 94301"), image_url="https://s3-media4.fl.yelpcdn.com/bphoto/pkjAVBK5wS95Bh8NVycomA/o.jpg"^^tt:picture }
]];
now => [reviewCount] of ((result(@com.yelp.restaurant[1])), id == "r6RztnVjcMq8wqI8o9ra_A"^^com.yelp:restaurant("Reposado")) => notify;	`
],

];

async function test(i) {
    console.log('Test Case #' + (i+1));

    try {
        const [stateCode, predictionCode, expected] = TEST_CASES[i];

        const state = await ThingTalk.Grammar.parseAndTypecheck(stateCode, schemas, true);
        const prediction = await ThingTalk.Grammar.parseAndTypecheck(predictionCode, schemas, true);

        const newState = computeNewState(state, prediction);
        const generated = newState.prettyprint();

        if (generated.trim() !== expected.trim()) {
            console.error('Test Case #' + (i+1) + ': code does not match what expected');
            console.error('Expected: ' + expected);
            console.error('Compiled: ' + generated);
            if (process.env.TEST_MODE)
                throw new Error(`testDialogueState ${i+1} FAILED`);
        }
    } catch (e) {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
        console.error(e.stack);
        if (process.env.TEST_MODE)
            throw e;
    }
}


async function main() {
    for (let i = 0; i < TEST_CASES.length; i++)
        await test(i);
}
if (module.parent)
    module.exports = main;
else
    main();
