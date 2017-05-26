// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('./polyfill');

const Q = require('q');
Q.longStackSupport = true;
const reconstruct = require('../lib/reconstruct_canonical');

const ThingTalk = require('thingtalk');
const SchemaRetriever = ThingTalk.SchemaRetriever;

const ThingpediaClientHttp = require('./http_client');
const db = require('./db');

var TEST_CASES = [
    // manually written test cases
    [{ action: { name: { id: 'tt:twitter.sink' }, args: [] } },
     'tweet ____'],
    [{ rule: {
        trigger: { name: { id: 'tt:twitter.source' }, args: [] },
        action: { name: { id: 'tt:twitter.sink' }, args: [
            { name: { id: 'tt:param.status'}, operator: 'is',
              type: 'VarRef', value: { id: 'tt:param.text' } }
        ]}
    } },
    'tweet text if anyone you follow tweets'],

    // sampled from dataset
    [{"rule":{"trigger":{"name":{"id":"tt:sportradar.soccer_us_tourney"},"args":[{"type":"String","operator":"is","value":{"value":"i'm happy"},"name":{"id":"tt:param.tournament_search_term"}},{"type":"String","operator":"contains","value":{"value":"i'm happy"},"name":{"id":"tt:param.tournament_full_name"}},{"type":"String","operator":"contains","value":{"value":"i'm happy"},"name":{"id":"tt:param.away_alias"}},{"type":"String","operator":"contains","value":{"value":"merry christmas"},"name":{"id":"tt:param.home_name"}},{"type":"Enum","operator":"is","value":{"value":"scheduled"},"name":{"id":"tt:param.game_status"}},{"type":"Number","operator":"is","value":{"value":14},"name":{"id":"tt:param.home_points"}}]},"action":{"name":{"id":"tt:almond_dates.post"},"args":[{"type":"String","operator":"is","value":{"value":"love you"},"name":{"id":"tt:param.interest"}},{"type":"String","operator":"is","value":{"value":"merry christmas"},"name":{"id":"tt:param.message"}},{"type":"String","operator":"is","value":{"value":"you would never believe what happened"},"name":{"id":"tt:param.poster"}},{"type":"PhoneNumber","operator":"is","value":{"value":"+16501234567"},"name":{"id":"tt:param.phone"}}]}}},
    'post on almond dates to look for people interested in "love you" and message is "merry christmas" and poster is "you would never believe what happened" and phone is +16501234567 if an American soccer game updates and tournament search term is "i\'m happy" and game status is scheduled and home points is 14 and tournament full name contains "i\'m happy" and away alias contains "i\'m happy" and home name contains "merry christmas"'],

    [{"rule":{"trigger":{"name":{"id":"tt:sportradar.soccer_us_team"},"args":[{"type":"Entity(sportradar:us_soccer_team)","operator":"is","value":{"value":"tor"},"name":{"id":"tt:param.watched_team_alias"}},{"type":"Bool","operator":"is","value":{"value":false},"name":{"id":"tt:param.watched_is_home"}},{"type":"String","operator":"is","value":{"value":"love you"},"name":{"id":"tt:param.away_name"}},{"type":"String","operator":"contains","value":{"value":"i'm happy"},"name":{"id":"tt:param.home_name"}},{"type":"Enum","operator":"is","value":{"value":"closed"},"name":{"id":"tt:param.game_status"}},{"type":"Date","operator":"is","value":{"year":2016,"month":5,"day":4,"hour":0,"minute":0,"second":0},"name":{"id":"tt:param.scheduled_time"}},{"type":"Number","operator":">","value":{"value":11},"name":{"id":"tt:param.home_points"}},{"type":"Enum","operator":"is","value":{"value":"unclosed"},"name":{"id":"tt:param.result"}}]},"action":{"name":{"id":"tt:slack.updateChannelPurpose"},"args":[{"type":"Hashtag","operator":"is","value":{"value":"funny"},"name":{"id":"tt:param.channel"}},{"type":"String","operator":"is","value":{"value":"research project"},"name":{"id":"tt:param.purpose"}}]}}},
    'update the purpose of slack channel #funny to "research project" if an American soccer game updates and watched team alias is tor and watched is home is no and away name is "love you" and game status is closed and scheduled time is 5/4/2016, 12:00:00 AM and result is unclosed and home name contains "i\'m happy" and home points is greater than 11'],

    [{"rule":{"query":{"name":{"id":"tt:uber.price_estimate"},"args":[{"type":"Location","operator":"is","value":{"relativeTag":"rel_home","latitude":-1,"longitude":-1},"name":{"id":"tt:param.start"}},{"type":"Location","operator":"is","value":{"relativeTag":"rel_work","latitude":-1,"longitude":-1},"name":{"id":"tt:param.end"}},{"type":"String","operator":"is","value":{"value":"love you"},"name":{"id":"tt:param.uber_type"}},{"type":"Number","operator":">","value":{"value":20},"name":{"id":"tt:param.high_estimate"}},{"type":"String","operator":"is","value":{"value":"love you"},"name":{"id":"tt:param.currency_code"}},{"type":"Measure","operator":">","value":{"value":1000,"unit":"m"},"name":{"id":"tt:param.distance"}}]},"action":{"name":{"id":"tt:almond_dates.post"},"args":[{"type":"String","operator":"is","value":{"value":"love you"},"name":{"id":"tt:param.interest"}},{"type":"String","operator":"is","value":{"value":"merry christmas"},"name":{"id":"tt:param.message"}},{"type":"String","operator":"is","value":{"value":"merry christmas"},"name":{"id":"tt:param.poster"}},{"type":"PhoneNumber","operator":"is","value":{"value":"+16501234567"},"name":{"id":"tt:param.phone"}}]}}},
    'get estimated prices for Uber from at home to at work and uber type is "love you" and currency code is "love you" and high estimate is greater than 20 and distance is greater than 1000 m then post on almond dates to look for people interested in "love you" and message is "merry christmas" and poster is "merry christmas" and phone is +16501234567'],
    [{"rule":{"trigger":{"name":{"id":"tt:sportradar.soccer_eu_tourney"},"args":[]},"action":{"name":{"id":"tt:thermostat.set_target_temperature"},"args":[]}}},
    'set your thermostat to ____ if an European soccer game updates'],
    [{"rule":{"trigger":{"name":{"id":"tt:instagram.new_picture"},"args":[{"type":"Location","operator":"is","value":{"relativeTag":"rel_work","latitude":-1,"longitude":-1},"name":{"id":"tt:param.location"}}]},"action":{"name":{"id":"tt:lg_webos_tv.play_url"},"args":[]}}},
    'play ____ on your LG WebOS TV if you upload a new picture on Instagram and location is at work'],
    [{"rule":{"trigger":{"name":{"id":"tt:washington_post.new_article"},"args":[{"type":"Enum","operator":"is","value":{"value":"national"},"name":{"id":"tt:param.section"}}]},"action":{"name":{"id":"tt:slack.updateChannelTopic"},"args":[{"type":"String","operator":"is","value":{"value":"you would never believe what happened"},"name":{"id":"tt:param.topic"}}]}}},
    'update the topic of slack channel ____ to "you would never believe what happened" if a new article is published in the national section of The Washington Post']
];

const LOCALE = 'en-US';
//var schemaRetriever = new SchemaRetriever(_mockSchemaDelegate);
var schemaRetriever = new SchemaRetriever(new ThingpediaClientHttp(null, LOCALE));

var dlg = { _(x) {return x;}, manager: { schemas: schemaRetriever } };

function test(i) {
    console.log('Test Case #' + (i+1));
    var [json, expected] = TEST_CASES[i];

    return reconstruct(dlg, json).then((reconstructed) => {
        if (expected !== reconstructed) {
            console.error('Test Case #' + (i+1) + ': does not match what expected');
            console.error('Expected: ' + expected);
            console.error('Generated: ' + reconstructed);
        }
    }).catch((e) => {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
    });
}

function loop(i) {
    if (i === TEST_CASES.length)
        return Q();

    return Q(test(i)).then(() => loop(i+1));
}

function main() {
    if (process.argv[2] === '--full-db') {
        db.withClient((dbClient) => {
            return db.selectAll(dbClient, "select target_json, utterance from example_utterances where type = 'generated-highvariance' and language = 'en' limit 100", []);
        }).then((rows) => {
            TEST_CASES = rows.map((r) => [JSON.parse(r.target_json), r.utterance]);
            return loop(0);
        }).done();
    } else {
        loop(0).done();
    }
}
main();
