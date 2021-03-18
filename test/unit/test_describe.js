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

import { Ast, Syntax, SchemaRetriever }  from 'thingtalk';

import { Describer, getProgramName } from '../../lib/utils/thingtalk/describe';
import * as I18n from '../../lib/i18n';

import _mockSchemaDelegate from './mock_schema_delegate';
const schemaRetriever = new SchemaRetriever(_mockSchemaDelegate, null, true);

const TEST_CASES = [
    ['now => @com.twitter.post(status=$undefined);',
     'Post on Twitter.',
     'Twitter'],
    ['monitor(@com.twitter.home_timeline()) => @com.twitter.post(status=text);',
    'Tweet the text when Twitter home timeline change.',
    'Twitter ⇒ Twitter'],

    ['attimer(time=[new Time(8,30)]) => @org.thingpedia.builtin.thingengine.builtin.say(message=$undefined);',
    'Say every day at 8:30 AM.',
    'Say'],
    ['attimer(time=[new Time(20,30)]) => @org.thingpedia.builtin.thingengine.builtin.say(message=$undefined);',
    'Say every day at 8:30 PM.',
    'Say'],
    ['attimer(time=[new Time(0,0)]) => @org.thingpedia.builtin.thingengine.builtin.say(message=$undefined);',
    'Say every day at 12:00 AM.',
    'Say'],
    ['attimer(time=[new Time(12,0)]) => @org.thingpedia.builtin.thingengine.builtin.say(message=$undefined);',
    'Say every day at 12:00 PM.',
    'Say'],
    [`attimer(time=[new Time(9,0), new Time(15,0)]) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's 9am or 3pm");`,
    `Send me a message it's 9am or 3pm every day at 9:00 AM and 3:00 PM.`,//'
    'Say'],
    [`attimer(time=[new Time(9,0)]) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's 9am");`,
    `Send me a message it's 9am every day at 9:00 AM.`,//'
    'Say'],
    [`attimer(time=[$time.morning]) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the morning");`,
    `Send me a message it's the morning every day in the morning.`,//'
    'Say'],
    [`attimer(time=[$time.evening]) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the evening");`,
    `Send me a message it's the evening every day in the evening.`,//'
    'Say'],
    [`timer(base=new Date(), interval=2h) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the evening");`,
    `Send me a message it's the evening every 2 h.`,//'
    'Say'],
    [`timer(base=new Date(), interval=2h, frequency=2) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the evening");`,
    `Send me a message it's the evening 2 times every 2 h.`,//'
    'Say'],

    [`now => @com.xkcd.get_comic() => notify;`,
    'Get the xkcd comic.',
    'Xkcd'],
    [`now => @com.xkcd.get_comic(number=42) => notify;`,
    'Get the xkcd comic with number 42.',
    'Xkcd',],
    [`now => @com.xkcd.get_comic(number=$undefined) => notify;`,
    'Get the xkcd comic with number ____.',
    'Xkcd'],
    [`monitor(@com.xkcd.get_comic()) => notify;`,
    'Notify me when the xkcd comic changes.',
    'Xkcd'],

    [`now => @org.thingpedia.weather.current(location=$location.current_location) => notify;`,
    `Get the current weather in here.`,
    'Weather'],
    [`now => @org.thingpedia.weather.current(location=$location.home) => notify;`,
    `Get the current weather at home.`,
    'Weather'],
    [`now => @org.thingpedia.weather.current(location=$location.work) => notify;`,
    `Get the current weather at work.`,
    'Weather'],
    [`now => @org.thingpedia.weather.current(location=new Location(37,-137)) => notify;`,
    `Get the current weather in [Latitude: 37.000 deg, Longitude: -137.000 deg].`,
    'Weather'],
    [`now => @org.thingpedia.weather.current(location=new Location(37,-137, "Somewhere")) => notify;`,
    `Get the current weather in Somewhere.`,
    'Weather'],

    /*[`now => @org.thingpedia.weather.sunrise(date=new Date(2018,4,24)) => notify;`,
    `get get the sunrise and sunset time for location ____ with date equal to 4/24/2018`,
    'Weather'],
    [`now => @org.thingpedia.weather.sunrise(date=new Date(2018,4,24,10,0,0)) => notify;`,
    `get get the sunrise and sunset time for location ____ with date equal to 4/24/2018, 10:00:00 AM`,
    'Weather'],
    [`now => @org.thingpedia.weather.sunrise(date=new Date(2018,4,24,22,0,0)) => notify;`,
    `get get the sunrise and sunset time for location ____ with date equal to 4/24/2018, 10:00:00 PM`,
    'Weather'],*/

    [`now => @com.instagram.get_pictures(), in_array(caption,["foo","bar"]) => notify;`,
    `Get pictures on instagram that have caption foo or bar.`,
    'Instagram'],
    [`now => @com.instagram.get_pictures(), contains(hashtags, "foo"^^tt:hashtag) => notify;`,
    `Get pictures on instagram that have hashtags #foo.`,
    'Instagram'],

    [`now => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code, text="hello") => @com.facebook.post(status=$result);`,
    `Get the translate on ytranslate with target language zh and text hello and then post on Facebook with status the result.`,
    'Yandex Translate ⇒ Facebook'],

    [`monitor (@com.xkcd.get_comic()) => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code("Chinese"), text=title) => @com.facebook.post(status=$result);`,
    `Do the following: when the xkcd comic changes, get the translate on ytranslate with target language Chinese and text the title, and then post on Facebook with status the result.`,
    'Xkcd ⇒ Yandex Translate ⇒ Facebook'],
    [`monitor (@com.xkcd.get_comic()) => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code("Chinese"), text=title) => notify;`,
    `Get the translate on ytranslate with target language Chinese and text the title when the xkcd comic changes.`,
    'Xkcd ⇒ Yandex Translate'],
    [`monitor (@com.xkcd.get_comic(), title =~ "lol") => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code("Chinese"), text=title) => notify;`,
    'Get the translate on ytranslate with target language Chinese and text the title when the xkcd comic changes if the title contains lol.',
    'Xkcd ⇒ Yandex Translate'],
    [`monitor (@com.xkcd.get_comic(), title =~ "lol") => notify;`,
    'Notify me when the xkcd comic changes if the title contains lol.',
    'Xkcd'],
    [`monitor (@com.xkcd.get_comic(), title =~ "lol") => @com.facebook.post(status=alt_text);`,
    `Post on Facebook with status the alt text when the xkcd comic changes if the title contains lol.`,
    'Xkcd ⇒ Facebook'],
    [`monitor (@com.gmail.inbox(), contains(labels, "work")) => @com.facebook.post(status=snippet);`,
    `Post on Facebook with status the snippet when list email in inbox change if the labels contain work.`,
    'Gmail ⇒ Facebook'],
    [`monitor (@com.gmail.inbox(), contains(labels, "work")) => @com.facebook.post(status=snippet);`,
    `Post on Facebook with status the snippet when list email in inbox change if the labels contain work.`,
    'Gmail ⇒ Facebook'],
    [`monitor (@com.gmail.inbox(), !contains(labels, "work")) => @com.facebook.post(status=snippet);`,
    `Post on Facebook with status the snippet when list email in inbox change if the labels don't contain work.`,
    'Gmail ⇒ Facebook'],

    ['monitor(@com.twitter.home_timeline(), contains~(hashtags, "funny")) => @com.twitter.post(status=text);',
    'Tweet the text when Twitter home timeline change if the hashtags contain funny.',
    'Twitter ⇒ Twitter'],
    ['monitor(@com.twitter.home_timeline(), text =~ "funny") => @com.twitter.post(status=text);',
    'Tweet the text when Twitter home timeline change if the text contains funny.',
    'Twitter ⇒ Twitter'],
    ['monitor(@com.twitter.home_timeline(), !(text =~ "funny")) => @com.twitter.post(status=text);',
    'Tweet the text when Twitter home timeline change if the text doesn\'t contain funny.',
    'Twitter ⇒ Twitter'],

    ['now => @uk.co.thedogapi.get() => notify;',
    'Get the get dogs.', 'Thedogapi'],

    ['now => @org.thingpedia.builtin.thingengine.phone.sms() => notify;',
    'Get my sms.', 'Phone'],
    ['now => @org.thingpedia.builtin.thingengine.phone.set_ringer(mode=enum(vibrate));',
    'Set ringer on phone with mode vibrate.', 'Phone'],

    ['now => @com.bing.web_search() => @com.yandex.translate.translate(target_language="it"^^tt:iso_lang_code("Italian"), text=$result) => notify;',
    'Get web searches on bing and then get the translate on ytranslate with target language Italian and text the result.',
    'Bing ⇒ Yandex Translate'],
    ['monitor(@com.bing.web_search()) => @com.yandex.translate.translate(target_language="it"^^tt:iso_lang_code("Italian"), text=$result) => notify;',
    'Get the translate on ytranslate with target language Italian and text the result when web searches on bing change.',
    'Bing ⇒ Yandex Translate'],

    [`now => avg(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'Get the average file size in Google drive files.',
    'Google Drive'],
    [`now => min(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'Get the minimum file size in Google drive files.',
    'Google Drive'],
    [`now => max(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'Get the maximum file size in Google drive files.',
    'Google Drive'],
    [`now => sum(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'Get the sum of the file size in Google drive files.',
    'Google Drive'],
    [`now => count(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'Get the number of file size in Google drive files.',
    'Google Drive'],
    [`now => count(file_name of @com.google.drive.list_drive_files()) => notify;`,
    'Get the number of file name in Google drive files.',
    'Google Drive'],
    [`now => count(@com.google.drive.list_drive_files()) => notify;`,
    'Get the number of Google drive files.',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[1] => notify;`,
    'Get the Google drive files with the minimum file size.',
    'Google Drive'],
    [`now => sort(file_size desc of @com.google.drive.list_drive_files())[-1] => notify;`,
    'Get the Google drive files with the minimum file size.',
    'Google Drive'],
    [`now => sort(file_size desc of @com.google.drive.list_drive_files())[1] => notify;`,
    'Get the Google drive files with the maximum file size.',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[-1] => notify;`,
    'Get the Google drive files with the maximum file size.',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[-1:5] => notify;`,
    'Get the 5 Google drive files with the maximum file size.',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[1:5] => notify;`,
    'Get the 5 Google drive files with the minimum file size.',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[1:$?] => notify;`,
    'Get the ____ Google drive files with the minimum file size.',
    'Google Drive'],
    [`now => sort(file_size desc of @com.google.drive.list_drive_files())[1:$?] => notify;`,
    'Get the ____ Google drive files with the maximum file size.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[1] => notify;`,
    'Get the first Google drive files.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[-1] => notify;`,
    'Get the last Google drive files.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[$?] => notify;`,
    'Get the Google drive files with index ____.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[1:$?] => notify;`,
    'Get the first ____ Google drive files.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[-1:$?] => notify;`,
    'Get the last ____ Google drive files.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[1:5] => notify;`,
    'Get the first 5 Google drive files.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[-1:5] => notify;`,
    'Get the last 5 Google drive files.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[2:5] => notify;`,
    'Get 5 elements starting from 2 of the Google drive files.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[-2:5] => notify;`,
    'Get 5 elements starting from -2 of the Google drive files.',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[1, 2, 7] => notify;`,
    'Get elements 1, 2, and 7 of the Google drive files.',
    'Google Drive'],

    [`now => [file_name] of sort(file_size asc of @com.google.drive.list_drive_files()) => notify;`,
    'Get the file name of the Google drive files sorted by increasing file size.',
    'Google Drive'],

    [`$yes;`,
    'Yes.', ''],

    [`$no;`,
    'No.', ''],

    [`$nevermind;`,
    'Cancel.', ''],

    [`$answer(42);`,
    '42.', ''],

    [`$choice(0);`,
    'Choice number 1.', ''],

    [`now => @com.spotify.get_currently_playing() => @com.spotify.add_songs_to_playlist(toAdd=song);`,
    'Get the get currently playing track name and then add songs to a playlist with to add the song.', 'Spotify ⇒ Spotify'],
    [`attimer(time=$?) => @com.twitter.post();`,
    `Post on Twitter every day at ____.`, 'Twitter'],
    [`now => @com.twitter.post(status = $context.selection : String);`,
    `Tweet the selection on the screen.`, `Twitter`],

    [`#[executor = "bob"^^tt:username] now => @com.twitter.post(status="lol");`,
    `Tell @bob: tweet lol.`, `Twitter`],

    [`#[executor = "bob"^^tt:username] monitor(@security-camera.current_event()) => @com.twitter.post(status="lol");`,
    `Tell @bob: tweet lol when the current event on security camera changes.`,
    `Security Camera ⇒ Twitter`],

    [`#[executor = "bob"^^tt:username] monitor(@security-camera.current_event()) => @com.yandex.translate.translate(text="lol") => @com.twitter.post(status=translated_text);`,
    `Tell @bob: do the following: when the current event on security camera changes, get the translate on ytranslate with text lol, and then tweet the translated text.`,
    `Security Camera ⇒ Yandex Translate ⇒ Twitter`],

    [`(monitor (@org.thingpedia.weather.current(location=$?))) filter temperature >= 5defaultTemperature => notify;`,
    'Notify me when the current weather in ____ changes and it becomes true that the temperature is greater than or equal to 5 F.', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10defaultTemperature => notify;`,
    'Get the current weather in ____ such that the temperature is greater than or equal to 10 F.', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10.2defaultTemperature => notify;`,
    'Get the current weather in ____ such that the temperature is greater than or equal to 10.2 F.', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10.33defaultTemperature => notify;`,
    'Get the current weather in ____ such that the temperature is greater than or equal to 10.3 F.', 'Weather'],

    [`now => (@com.yelp.restaurant()), true(cuisines) => notify;`,
    `Get restaurants such that any value of cuisines is acceptable.`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) => notify;`,
    `Get restaurants that have Mexican food.`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) && price == enum(cheap) => notify;`,
    `Get cheap restaurants that have Mexican food.`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) && rating == 4 => notify;`,
    `Get restaurants that have Mexican food rated 4 star.`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) && rating >= 4 => notify;`,
    `Get restaurants that have Mexican food such that the rating is greater than or equal to 4.`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) && geo == new Location("Palo Alto") => notify;`,
    `Get restaurants that have Mexican food near Palo Alto.`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), geo == new Location("Palo Alto") && contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) => notify;`,
    `Get restaurants that have Mexican food near Palo Alto.`,
    `Yelp`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(, 6, ) => notify;`,
     `Get today's date such that the date is after start of day on day 1 of June, this year.`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(, 6, , 12, 0, 0) => notify;`,
     `Get today's date such that the date is after 12:00 PM on day 1 of June, this year.`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(2020, 6, ) => notify;`,
     `Get today's date such that the date is after June 1, 2020.`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(2020, 6, , 12, 0, 0) => notify;`,
     `Get today's date such that the date is after June 1, 2020 at 12:00 PM.`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(, 6, 3, 12, 0, 0) => notify;`,
     `Get today's date such that the date is after 12:00 PM on day 3 of June, this year.`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(, 6, 3) => notify;`,
     `Get today's date such that the date is after start of day on day 3 of June, this year.`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(enum monday) => notify;`,
     `Get today's date such that the date is after start of day on Monday.`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(enum monday, 12, 0, 0) => notify;`,
     `Get today's date such that the date is after 12:00 PM on Monday.`,
     `Get Date`],

    [`@com.wsj.get(section=enum world_news);`,
    'Get articles published in the world news section of the wall street journal.',
    'Wsj'],
];

async function test(i) {
    console.log('Test Case #' + (i+1));
    let [code, expected, expectedname] = TEST_CASES[i];

    const langPack = I18n.get('en-US');

    let failed = false;
    try {
        const prog = await Syntax.parse(code).typecheck(schemaRetriever, true);
        const allocator = new Syntax.SequentialEntityAllocator({});
        const describer = new Describer('en-US', 'America/Los_Angeles', allocator);
        // retrieve the relevant primitive templates
        const kinds = new Set();
        for (const [, prim] of prog.iteratePrimitives(false))
            kinds.add(prim.selector.kind);
        for (const kind of kinds)
            describer.setDataset(kind, await schemaRetriever.getExamplesByKind(kind));

        let reconstructed = describer.describe(prog).chooseBest();
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
            failed = true;
        } else if (prog instanceof Ast.Program) {
            let name = getProgramName(prog);
            if (name !== expectedname) {
                console.error('Test Case #' + (i+1) + ': does not match what expected');
                console.error('Expected: ' + expectedname);
                console.error('Generated: ' + name);
                failed = true;
            }
        }
    } catch(e) {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error(code);
        console.error('Error: ' + e.message);
        console.error(e.stack);
        if (process.env.TEST_MODE)
            throw e;
    }
    if (failed && process.env.TEST_MODE)
        throw new Error(`testDescribe ${i+1} FAILED`);
}

export default async function main() {
    for (let i = 0; i < TEST_CASES.length; i++)
        await test(i);
}
if (!module.parent)
    main();
