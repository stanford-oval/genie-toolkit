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
import * as I18n from '../../lib/i18n';

import _mockSchemaDelegate from './mock_schema_delegate';
const schemaRetriever = new SchemaRetriever(_mockSchemaDelegate, null, true);

let TEST_CASES = [
    ['true : * => *',
     'Anyone is allowed to read all your data and then perform any action with it.'],

    ['true : * => notify',
     'Anyone is allowed to read all your data.'],

    ['true : now => *',
     'Anyone is allowed to perform any action.'],

    ['true : @com.bing.* => *',
     'Anyone is allowed to read your Bing and then perform any action with it.'],

    ['true : @com.bing.* => notify',
     'Anyone is allowed to read your Bing.'],

    ['true : * => @com.twitter.*',
     'Anyone is allowed to read all your data and then use it to perform any action on your Twitter.'],

    ['true : now => @com.twitter.*',
     'Anyone is allowed to perform any action on your Twitter.'],

    ['true : now => @com.twitter.post',
     'Anyone is allowed to post on Twitter.'],

    ['true : * => @com.twitter.post',
     'Anyone is allowed to read all your data and then use it to post on Twitter.'],

    ['true : @com.bing.* => @com.twitter.post',
     'Anyone is allowed to read your Bing and then use it to post on Twitter.'],

    ['true : @com.bing.web_search => *',
     'Anyone is allowed to read web searches on bing and then perform any action with it.'],

    ['true : @com.bing.web_search => @com.twitter.*',
     'Anyone is allowed to read web searches on bing and then use it to perform any action on your Twitter.'],

    ['source == null^^tt:contact("mom") : now => @com.twitter.post',
     'Mom is allowed to post on Twitter.'],

    ['group_member(source, null^^tt:contact_group("family")) : now => @com.twitter.post',
     'Anyone in the family group is allowed to post on Twitter.'],

    ['source == null^^tt:contact("mom") || source == null^^tt:contact("dad") : now => @com.twitter.post',
     'If the requester is equal to mom or the requester is equal to dad, the requester is allowed to post on Twitter.'],

    ['true : now => @com.twitter.post, status == "foo"',
     'Anyone is allowed to tweet foo.'],

    ['true : now => @com.twitter.post, !(status == "foo")',
     'Anyone is allowed to post on Twitter if the status is not equal to foo.'],

    ['true : now => @com.twitter.post, status =~ "foo"',
     'Anyone is allowed to post on Twitter if the status contains foo.'],

    ['true : now => @com.twitter.post, !(status =~ "foo")',
     'Anyone is allowed to post on Twitter if the status doesn\'t contain foo.'],

    ['true : now => @com.twitter.post, starts_with(status, "foo")',
     'Anyone is allowed to post on Twitter if the status starts with foo.'],

    ['true : now => @com.twitter.post, !starts_with(status, "foo")',
     'Anyone is allowed to post on Twitter if the status doesn\'t start with foo.'],

    ['true : now => @com.twitter.post, ends_with(status, "foo")',
     'Anyone is allowed to post on Twitter if the status ends with foo.'],

    ['true : now => @com.twitter.post, !ends_with(status, "foo")',
     'Anyone is allowed to post on Twitter if the status doesn\'t end with foo.'],

    ['true : now => @com.twitter.post, prefix_of(status, "foo")',
     'Anyone is allowed to post on Twitter if the status is a prefix of foo.'],

    ['true : now => @com.twitter.post, !prefix_of(status, "foo")',
     'Anyone is allowed to post on Twitter if the status is not a prefix of foo.'],

    ['true : now => @com.twitter.post, suffix_of(status, "foo")',
     'Anyone is allowed to post on Twitter if the status is a suffix of foo.'],

    ['true : now => @com.twitter.post, !suffix_of(status, "foo")',
     'Anyone is allowed to post on Twitter if the status is not a suffix of foo.'],

    ['true : now => @com.twitter.post, status == "foo" || status == "bar"',
     'Anyone is allowed to post on Twitter if the status is any of foo or bar.'],

    ['true : now => @com.twitter.post, status =~ "foo" && status =~ "bar"',
     'Anyone is allowed to post on Twitter if the status contains foo and the status contains bar.'],

    ['true : now => @thermostat.set_target_temperature, value == 70F',
     'Anyone is allowed to set target temperature on thermostat if the value is equal to 70 F.'],

    ['true : now => @thermostat.set_target_temperature, value >= 70F',
     'Anyone is allowed to set target temperature on thermostat if the value is greater than or equal to 70 F.'],

    ['true : now => @thermostat.set_target_temperature, value <= 70F',
     'Anyone is allowed to set target temperature on thermostat if the value is less than or equal to 70 F.'],

    ['true : now => @thermostat.set_target_temperature, !(value >= 70F)',
     'Anyone is allowed to set target temperature on thermostat if the value is less than 70 F.'],

    ['true : now => @thermostat.set_target_temperature, !(value <= 70F)',
     'Anyone is allowed to set target temperature on thermostat if the value is greater than 70 F.'],

    ['true : @security-camera.current_event => notify',
     'Anyone is allowed to read the current event on security camera.'],

    ['true : @security-camera.current_event, has_person == true => notify',
     'Anyone is allowed to read the current event on security camera if the has person is equal to true.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(19,0) } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is after 7:00 PM.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(12,0) } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is after 12:00 PM.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(0,0) } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is after 12:00 AM.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(7,30) } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is after 7:30 AM.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(7,30,15) } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is after 7:30:15 AM.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(19,30,15) } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is after 7:30:15 PM.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= $context.time.morning } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is after the morning.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time <= $context.time.evening } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is before the evening.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_time() { time >= makeTime(17,00) && time <= makeTime(19,00) } => notify',
     'Anyone is allowed to read the current event on security camera if the current time is before 7:00 PM and the current time is after 5:00 PM.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_gps() { location == $context.location.home } => notify',
     'Anyone is allowed to read the current event on security camera if my location is equal to home.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_gps() { !(location == $context.location.home) } => notify',
     'Anyone is allowed to read the current event on security camera if my location is not equal to home.'],

    ['true : @security-camera.current_event, @org.thingpedia.builtin.thingengine.builtin.get_gps() { !(location == $context.location.home) && !(location == $context.location.work) } => notify',
     'Anyone is allowed to read the current event on security camera if my location is not equal to home and my location is not equal to work.'],

    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { temperature >= 21C } => notify',
     'Anyone is allowed to read the current event on security camera if the temperature of the current weather in here is greater than or equal to 69.8 F.'],
    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { temperature == 21C } => notify',
     'Anyone is allowed to read the current event on security camera if the temperature of the current weather in here is equal to 69.8 F.'],
    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { !(temperature == 21C) } => notify',
     'Anyone is allowed to read the current event on security camera if the temperature of the current weather in here is not equal to 69.8 F.'],
    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { temperature <= 21C && temperature >= 19C } => notify',
     'Anyone is allowed to read the current event on security camera if for the current weather in here, the temperature is less than or equal to 69.8 F and the temperature is greater than or equal to 66.2 F.'],
    ['true : @security-camera.current_event, @org.thingpedia.weather.current(location=$context.location.current_location) { temperature >= 21C || temperature <= 19C } => notify',
     'Anyone is allowed to read the current event on security camera if for the current weather in here, the temperature is less than or equal to 66.2 F or the temperature is greater than or equal to 69.8 F.'],


    ['true : @com.bing.web_search, query == "foo" => notify',
     'Anyone is allowed to read websites matching foo.'],

    ['true : @com.bing.web_search, query == "foo" || query == "bar" => notify',
     'Anyone is allowed to read web searches on bing if the query is any of foo or bar.'],

    ['true : @com.bing.web_search, query == "foo" && description =~ "lol" => notify',
     'Anyone is allowed to read websites matching foo if the description contains lol.'],

    ['true : @com.bing.web_search, !(query == "foo" && description =~ "lol") => notify',
     'Anyone is allowed to read web searches on bing if not the description contains lol and the query is equal to foo.'],

    ['true : @com.bing.web_search, (query == "foo" || query == "bar") && description =~ "lol" => notify',
     'Anyone is allowed to read web searches on bing if the description contains lol and the query is any of foo or bar.'],

    ['true : @com.washingtonpost.get_article => notify',
    'Anyone is allowed to read articles on washington post.'],

    ['true : @com.washingtonpost.get_article, section == enum(world) => notify',
    'Anyone is allowed to read articles on washington post if the section is equal to world.'],

    ['true : @com.washingtonpost.get_article, section == enum(world) || section == enum(opinions) => notify',
    'Anyone is allowed to read articles on washington post if the section is any of opinions or world.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate() => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after now.'],
    ['true : @com.wsj.get, section == enum(world_news) && updated <= makeDate() => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is before now.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate(2018, 5, 4) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after May 4, 2018.'],
    ['true : @com.wsj.get, section == enum(world_news) && updated <= makeDate(2018, 5, 4) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is before May 4, 2018.'],
    ['true : @com.wsj.get, section == enum(world_news) && !(updated <= makeDate(2018, 5, 4)) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after May 4, 2018.'],
    ['true : @com.wsj.get, section == enum(world_news) && !(updated >= makeDate(2018, 5, 4)) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is before May 4, 2018.'],

    /*['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate(2018, 5, 4, 17, 30, 0) => notify',
    'Anyone is allowed to read articles published in the world news section if the updated is after 5/4/2018, 5:30:00 PM'],*/

    ['true : @com.wsj.get, section == enum(world_news) && updated >= start_of(day) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after the start of today.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= start_of(week) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after the start of this week.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= start_of(mon) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after the start of this month.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= start_of(year) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after the start of this year.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= end_of(day) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after the end of today.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= end_of(week) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after the end of this week.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= end_of(mon) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after the end of this month.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= end_of(year) => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after the end of this year.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate() + 1h => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after 60 min past now.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate() + 30min => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after 30 min past now.'],

    ['true : @com.wsj.get, section == enum(world_news) && updated >= makeDate() - 30min => notify',
    'Anyone is allowed to read articles published in the world news section of the wall street journal if the updated is after 30 min before now.'],
];

async function test(i) {
    console.log('Test Case #' + (i+1));
    const [code, expected] = TEST_CASES[i];
    const langPack = I18n.get('en-US');

    const allocator = new Syntax.SequentialEntityAllocator({});
    const describer = new Describer('en-US', 'America/Los_Angeles', allocator);
    const prog = await Syntax.parse(code, Syntax.SyntaxType.Legacy).typecheck(schemaRetriever, true);
    try {
        assert(prog.isPermissionRule);
        // retrieve the relevant primitive templates
        const kinds = new Set();
        if (prog.query.isSpecified)
            kinds.add(prog.query.kind);
        if (prog.action.isSpecified)
            kinds.add(prog.action.kind);
        for (const kind of kinds)
            describer.setDataset(kind, await schemaRetriever.getExamplesByKind(kind));

        let reconstructed = describer.describePermissionRule(prog);
        reconstructed = langPack.postprocessNLG(langPack.postprocessSynthetic(reconstructed, prog, null, 'agent'), allocator.entities, {
            timezone: 'America/Los_Angeles',
            getPreferredUnit(key) {
                return undefined;
            }
        });

        if (expected !== reconstructed) {
            console.error('Test Case #' + (i+1) + ': does not match what expected');
            console.error('Expected: ' + expected);
            console.error('Generated: ' + reconstructed);
            if (process.env.TEST_MODE)
                throw new Error(`testDescribePolicy ${i+1} FAILED`);
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
