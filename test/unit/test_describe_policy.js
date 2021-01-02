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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import assert from 'assert';
import { Syntax, SchemaRetriever }  from 'thingtalk';
import { Describer } from '../../lib/utils/thingtalk/describe';

import _mockSchemaDelegate from './mock_schema_delegate';
const schemaRetriever = new SchemaRetriever(_mockSchemaDelegate, null, true);

let TEST_CASES = [
    ['true : * => *',
     'anyone is allowed to read all your data and then perform any action with it'],

    ['true : * => notify',
     'anyone is allowed to read all your data'],

    ['true : now => *',
     'anyone is allowed to perform any action'],

    ['true : @com.bing.* => *',
     'anyone is allowed to read your Bing and then perform any action with it'],

    ['true : @com.bing.* => notify',
     'anyone is allowed to read your Bing'],

    ['true : * => @com.twitter.*',
     'anyone is allowed to read all your data and then use it to perform any action on your Twitter'],

    ['true : now => @com.twitter.*',
     'anyone is allowed to perform any action on your Twitter'],

    // manually written test cases
    ['true : now => @com.twitter.post',
     'anyone is allowed to tweet any status'],

    ['true : * => @com.twitter.post',
     'anyone is allowed to read all your data and then use it to tweet any status'],

    ['true : @com.bing.* => @com.twitter.post',
     'anyone is allowed to read your Bing and then use it to tweet any status'],

    ['true : @com.bing.web_search => *',
     'anyone is allowed to read websites matching any query on Bing and then perform any action with it'],

    ['true : @com.bing.web_search => @com.twitter.*',
     'anyone is allowed to read websites matching any query on Bing and then use it to perform any action on your Twitter'],

    ['source == "mom"^^tt:username : now => @com.twitter.post',
     '@mom is allowed to tweet any status'],

    ['group_member(source, "family"^^tt:contact_group_name) : now => @com.twitter.post',
     'anyone in the @family group is allowed to tweet any status'],

    ['source == "mom"^^tt:username || source == "dad"^^tt:username : now => @com.twitter.post',
     'if the requester is equal to @mom or the requester is equal to @dad, the requester is allowed to tweet any status'],

    ['true : now => @com.twitter.post, status == "foo"',
     'anyone is allowed to tweet “foo”'],

    ['true : now => @com.twitter.post, !(status == "foo")',
     'anyone is allowed to tweet any status if the status is not equal to “foo”'],

    ['true : now => @com.twitter.post, status =~ "foo"',
     'anyone is allowed to tweet any status if the status contains “foo”'],

    ['true : now => @com.twitter.post, !(status =~ "foo")',
     'anyone is allowed to tweet any status if the status does not contain “foo”'],

    ['true : now => @com.twitter.post, starts_with(status, "foo")',
     'anyone is allowed to tweet any status if the status starts with “foo”'],

    ['true : now => @com.twitter.post, !starts_with(status, "foo")',
     'anyone is allowed to tweet any status if the status does not start with “foo”'],

    ['true : now => @com.twitter.post, ends_with(status, "foo")',
     'anyone is allowed to tweet any status if the status ends with “foo”'],

    ['true : now => @com.twitter.post, !ends_with(status, "foo")',
     'anyone is allowed to tweet any status if the status does not end with “foo”'],

    ['true : now => @com.twitter.post, prefix_of(status, "foo")',
     'anyone is allowed to tweet any status if the status is a prefix of “foo”'],

    ['true : now => @com.twitter.post, !prefix_of(status, "foo")',
     'anyone is allowed to tweet any status if the status is not a prefix of “foo”'],

    ['true : now => @com.twitter.post, suffix_of(status, "foo")',
     'anyone is allowed to tweet any status if the status is a suffix of “foo”'],

    ['true : now => @com.twitter.post, !suffix_of(status, "foo")',
     'anyone is allowed to tweet any status if the status is not a suffix of “foo”'],

    ['true : now => @com.twitter.post, status == "foo" || status == "bar"',
     'anyone is allowed to tweet any status if the status is any of “foo” or “bar”'],

    ['true : now => @com.twitter.post, status =~ "foo" && status =~ "bar"',
     'anyone is allowed to tweet any status if the status contains “foo” and the status contains “bar”'],

    ['true : now => @thermostat.set_target_temperature, value == 70F',
     'anyone is allowed to set your thermostat to 70 F'],

    ['true : now => @thermostat.set_target_temperature, value >= 70F',
     'anyone is allowed to set your thermostat to any value if the value is greater than or equal to 70 F'],

    ['true : now => @thermostat.set_target_temperature, value <= 70F',
     'anyone is allowed to set your thermostat to any value if the value is less than or equal to 70 F'],

    ['true : now => @thermostat.set_target_temperature, !(value >= 70F)',
     'anyone is allowed to set your thermostat to any value if the value is less than 70 F'],

    ['true : now => @thermostat.set_target_temperature, !(value <= 70F)',
     'anyone is allowed to set your thermostat to any value if the value is greater than 70 F'],

    ['true : @security-camera.current_event => notify',
     'anyone is allowed to read the current event detected on your security camera'],

    ['true : @security-camera.current_event, has_person == true => notify',
     'anyone is allowed to read the current event detected on your security camera if the has person is equal to true'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(19,0) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is after 7:00 PM'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(12,0) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is after 12:00 PM'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(0,0) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is after 12:00 AM'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(7,30) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is after 7:30 AM'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(7,30,15) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is after 7:30:15 AM'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(19,30,15) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is after 7:30:15 PM'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= $context.time.morning } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is after the morning'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time <= $context.time.evening } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is before the evening'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(17,00) && time <= makeTime(19,00) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the current time is before 7:00 PM and the current time is after 5:00 PM'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_gps() { location == $context.location.home } => notify',
     'anyone is allowed to read the current event detected on your security camera if the my location is equal to at home'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_gps() { !(location == $context.location.home) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the my location is not equal to at home'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_gps() { !(location == $context.location.home) && !(location == $context.location.work) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the my location is not equal to at home and the my location is not equal to at work'],

    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { temperature >= 21C } => notify',
     'anyone is allowed to read the current event detected on your security camera if the temperature of the current weather for here is greater than or equal to 21 C'],
    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { temperature == 21C } => notify',
     'anyone is allowed to read the current event detected on your security camera if the temperature of the current weather for here is equal to 21 C'],
    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { !(temperature == 21C) } => notify',
     'anyone is allowed to read the current event detected on your security camera if the temperature of the current weather for here is not equal to 21 C'],
    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { temperature <= 21C && temperature >= 19C } => notify',
     'anyone is allowed to read the current event detected on your security camera if for the current weather for here, the temperature is less than or equal to 21 C and the temperature is greater than or equal to 19 C'],
    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { temperature >= 21C || temperature <= 19C } => notify',
     'anyone is allowed to read the current event detected on your security camera if for the current weather for here, the temperature is less than or equal to 19 C or the temperature is greater than or equal to 21 C'],


    ['true : @com.bing.web_search, query == "foo" => notify',
     'anyone is allowed to read websites matching “foo” on Bing'],

    ['true : @com.bing.web_search, query == "foo" || query == "bar" => notify',
     'anyone is allowed to read websites matching any query on Bing if the query is any of “foo” or “bar”'],

    ['true : @com.bing.web_search, query == "foo" && description =~ "lol" => notify',
     'anyone is allowed to read websites matching “foo” on Bing if the description contains “lol”'],

    ['true : @com.bing.web_search, !(query == "foo" && description =~ "lol") => notify',
     'anyone is allowed to read websites matching any query on Bing if not the description contains “lol” and the query is equal to “foo”'],

    ['true : @com.bing.web_search, (query == "foo" || query == "bar") && description =~ "lol" => notify',
     'anyone is allowed to read websites matching any query on Bing if the description contains “lol” and the query is any of “foo” or “bar”'],

    ['true : @com.washingtonpost.get_article => notify',
    'anyone is allowed to read the latest articles in the any section section of the Washington Post'],

    ['true : @com.washingtonpost.get_article, section == enum(world) => notify',
    'anyone is allowed to read the latest articles in the world section of the Washington Post'],

    ['true : @com.washingtonpost.get_article, section == enum(world) || section == enum(opinions) => notify',
    'anyone is allowed to read the latest articles in the any section section of the Washington Post if the section is any of opinions or world'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate() => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after now'],
    ['true : @com.wsj.get, section == enum(world_news) && updated <= makeDate() => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is before now'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate(2018, 5, 4) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after Friday, May 4, 2018'],
    ['true : @com.wsj.get, section == enum(world_news) && updated <= makeDate(2018, 5, 4) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is before Friday, May 4, 2018'],
    ['true : @com.wsj.get, section == enum(world_news) && !(updated <= makeDate(2018, 5, 4)) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after Friday, May 4, 2018'],
    ['true : @com.wsj.get, section == enum(world_news) && !(updated >= makeDate(2018, 5, 4)) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is before Friday, May 4, 2018'],

    /*['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate(2018, 5, 4, 17, 30, 0) => notify',
    'anyone is allowed to read articles published in the world news section if the updated is after 5/4/2018, 5:30:00 PM'],*/

    ['true : @com.wsj.get, section == enum(world_news) && updated >= start_of(day) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after the start of today'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= start_of(week) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after the start of this week'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= start_of(mon) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after the start of this month'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= start_of(year) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after the start of this year'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= end_of(day) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after the end of today'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= end_of(week) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after the end of this week'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= end_of(mon) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after the end of this month'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= end_of(year) => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after the end of this year'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate() + 1h => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after 1 h past now'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate() + 30min => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after 30 min past now'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate() - 30min => notify',
    'anyone is allowed to read articles published in the world news section of the Wall Street Journal if the updated is after 30 min before now'],
];

const gettext = {
    locale: 'en-US',
    dgettext: (domain, msgid) => msgid,
    dngettext: (domain, msgid, msgid_plural, n) => n === 1 ? msgid : msgid_plural,
};

function test(i) {
    console.log('Test Case #' + (i+1));
    const [code, expected] = TEST_CASES[i];

    const describer = new Describer(gettext, 'en-US', 'America/Los_Angeles');
    return Syntax.parse(code, Syntax.SyntaxType.Legacy).typecheck(schemaRetriever, true).then((prog) => {
        assert(prog.isPermissionRule);
        let reconstructed = describer.describePermissionRule(prog);

        reconstructed = reconstructed.replace('2018-5-4', '5/4/2018');

        if (expected !== reconstructed) {
            console.error('Test Case #' + (i+1) + ': does not match what expected');
            console.error('Expected: ' + expected);
            console.error('Generated: ' + reconstructed);
            if (process.env.TEST_MODE)
                throw new Error(`testDescribePolicy ${i+1} FAILED`);
        }
    }).catch((e) => {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
        console.error(e.stack);
        if (process.env.TEST_MODE)
            throw e;
    });
}

export default async function main() {
    for (let i = 0; i < TEST_CASES.length; i++)
        await test(i);
}
if (!module.parent)
    main();
