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

import _mockSchemaDelegate from './mock_schema_delegate';
const schemaRetriever = new SchemaRetriever(_mockSchemaDelegate, null, true);

const TEST_CASES = [
    // manually written test cases
    ['now => @com.twitter.post(status=$undefined);',
     'tweet ____',
     'Twitter'],
    ['monitor(@com.twitter.home_timeline()) => @com.twitter.post(status=text);',
    'tweet the text when tweets from anyone you follow change',
    'Twitter ⇒ Twitter'],

    ['attimer(time=[new Time(8,30)]) => @org.thingpedia.builtin.thingengine.builtin.say(message=$undefined);',
    'send you the message ____ every day at 8:30 AM',
    'Say'],
    ['attimer(time=[new Time(20,30)]) => @org.thingpedia.builtin.thingengine.builtin.say(message=$undefined);',
    'send you the message ____ every day at 8:30 PM',
    'Say'],
    ['attimer(time=[new Time(0,0)]) => @org.thingpedia.builtin.thingengine.builtin.say(message=$undefined);',
    'send you the message ____ every day at 12:00 AM',
    'Say'],
    ['attimer(time=[new Time(12,0)]) => @org.thingpedia.builtin.thingengine.builtin.say(message=$undefined);',
    'send you the message ____ every day at 12:00 PM',
    'Say'],
    [`attimer(time=[new Time(9,0), new Time(15,0)]) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's 9am or 3pm");`,
    `send you the message “it's 9am or 3pm” every day at 9:00 AM and 3:00 PM`,//'
    'Say'],
    [`attimer(time=[new Time(9,0)]) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's 9am");`,
    `send you the message “it's 9am” every day at 9:00 AM`,//'
    'Say'],
    [`attimer(time=[$time.morning]) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the morning");`,
    `send you the message “it's the morning” every day at the morning`,//'
    'Say'],
    [`attimer(time=[$time.evening]) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the evening");`,
    `send you the message “it's the evening” every day at the evening`,//'
    'Say'],
    [`timer(base=new Date(), interval=2h) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the evening");`,
    `send you the message “it's the evening” every 2 h`,//'
    'Say'],
    [`timer(base=new Date(), interval=2h, frequency=2) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the evening");`,
    `send you the message “it's the evening” twice every 2 h`,//'
    'Say'],

    [`now => @com.xkcd.get_comic() => notify;`,
    'get an Xkcd comic',
    'Xkcd'],
    [`now => @com.xkcd.get_comic(number=42) => notify;`,
    'get an Xkcd comic with number equal to 42',
    'Xkcd',],
    [`now => @com.xkcd.get_comic(number=$undefined) => notify;`,
    'get an Xkcd comic with number equal to ____',
    'Xkcd'],
    [`monitor(@com.xkcd.get_comic()) => notify;`,
    'notify you when an Xkcd comic changes',
    'Xkcd'],

    [`now => @org.thingpedia.weather.current(location=$location.current_location) => notify;`,
    `get the current weather for here`,
    'Weather'],
    [`now => @org.thingpedia.weather.current(location=$location.home) => notify;`,
    `get the current weather for at home`,
    'Weather'],
    [`now => @org.thingpedia.weather.current(location=$location.work) => notify;`,
    `get the current weather for at work`,
    'Weather'],
    [`now => @org.thingpedia.weather.current(location=new Location(37,-137)) => notify;`,
    `get the current weather for [Latitude: 37 deg, Longitude: -137 deg]`,
    'Weather'],
    [`now => @org.thingpedia.weather.current(location=new Location(37,-137, "Somewhere")) => notify;`,
    `get the current weather for Somewhere`,
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
    `get your recent Instagram pictures that have caption “foo” or “bar”`,
    'Instagram'],
    [`now => @com.instagram.get_pictures(), contains(hashtags, "foo"^^tt:hashtag) => notify;`,
    `get your recent Instagram pictures that have hashtags #foo`,
    'Instagram'],

    [`now => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code, text="hello") => @com.facebook.post(status=$result);`,
    `get the translation of “hello” to zh and then post the result on Facebook`,
    'Yandex Translate ⇒ Facebook'],
    [`now => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code) => @com.facebook.post(status=$type);`,
    `get the translation of ____ to zh and then post the device type on Facebook`,
    'Yandex Translate ⇒ Facebook'],
    [`now => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code) => @com.facebook.post(status=$program_id);`,
    `get the translation of ____ to zh and then post the program ID on Facebook`,
    'Yandex Translate ⇒ Facebook'],
    [`now => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code("Chinese")) => @com.facebook.post(status=$program_id);`,
    `get the translation of ____ to Chinese and then post the program ID on Facebook`,
    'Yandex Translate ⇒ Facebook'],

    [`monitor (@com.xkcd.get_comic()) => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code("Chinese"), text=title) => @com.facebook.post(status=$result);`,
    `do the following: when an Xkcd comic changes, get the translation of the title to Chinese, and then post the result on Facebook`,
    'Xkcd ⇒ Yandex Translate ⇒ Facebook'],
    [`monitor (@com.xkcd.get_comic()) => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code("Chinese"), text=title) => notify;`,
    `get the translation of the title to Chinese when an Xkcd comic changes`,
    'Xkcd ⇒ Yandex Translate'],
    [`monitor (@com.xkcd.get_comic(), title =~ "lol") => @com.yandex.translate.translate(target_language="zh"^^tt:iso_lang_code("Chinese"), text=title) => notify;`,
    'get the translation of the title to Chinese when an Xkcd comic changes if the title contains “lol”',
    'Xkcd ⇒ Yandex Translate'],
    [`monitor (@com.xkcd.get_comic(), title =~ "lol") => notify;`,
    'notify you when an Xkcd comic changes if the title contains “lol”',
    'Xkcd'],
    [`monitor (@com.xkcd.get_comic(), title =~ "lol") => @com.facebook.post(status=link);`,
    `post the link on Facebook when an Xkcd comic changes if the title contains “lol”`,
    'Xkcd ⇒ Facebook'],
    [`monitor (@com.gmail.inbox(), contains(labels, "work")) => @com.facebook.post(status=snippet);`,
    `post the snippet on Facebook when the emails in your GMail inbox change if the labels contain “work”`,
    'Gmail ⇒ Facebook'],
    [`monitor (@com.gmail.inbox(), contains(labels, "work")) => @com.facebook.post(status=snippet);`,
    `post the snippet on Facebook when the emails in your GMail inbox change if the labels contain “work”`,
    'Gmail ⇒ Facebook'],
    [`monitor (@com.gmail.inbox(), !contains(labels, "work")) => @com.facebook.post(status=snippet);`,
    `post the snippet on Facebook when the emails in your GMail inbox change if the labels do not contain “work”`,
    'Gmail ⇒ Facebook'],

    ['monitor(@com.twitter.home_timeline(), contains~(hashtags, "funny")) => @com.twitter.post(status=text);',
    'tweet the text when tweets from anyone you follow change if the hashtags contain “funny”',
    'Twitter ⇒ Twitter'],
    ['monitor(@com.twitter.home_timeline(), text =~ "funny") => @com.twitter.post(status=text);',
    'tweet the text when tweets from anyone you follow change if the text contains “funny”',
    'Twitter ⇒ Twitter'],
    ['monitor(@com.twitter.home_timeline(), !(text =~ "funny")) => @com.twitter.post(status=text);',
    'tweet the text when tweets from anyone you follow change if the text does not contain “funny”',
    'Twitter ⇒ Twitter'],

    ['now => @uk.co.thedogapi.get() => notify;',
    'get dog pictures', 'Thedogapi'],

    ['now => @org.thingpedia.builtin.thingengine.phone.sms() => notify;',
    'get your SMS', 'Phone'],
    ['now => @org.thingpedia.builtin.thingengine.phone.set_ringer(mode=enum(vibrate));',
    'set your phone to vibrate', 'Phone'],

    ['now => @com.bing.web_search() => @com.yandex.translate.translate(target_language="it"^^tt:iso_lang_code("Italian"), text=$result) => notify;',
    'get websites matching ____ on Bing and then get the translation of the result to Italian',
    'Bing ⇒ Yandex Translate'],
    ['monitor(@com.bing.web_search()) => @com.yandex.translate.translate(target_language="it"^^tt:iso_lang_code("Italian"), text=$result) => notify;',
    'get the translation of the result to Italian when websites matching ____ on Bing change',
    'Bing ⇒ Yandex Translate'],

    [`now => avg(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'get the average file size in files in your Google Drive',
    'Google Drive'],
    [`now => min(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'get the minimum file size in files in your Google Drive',
    'Google Drive'],
    [`now => max(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'get the maximum file size in files in your Google Drive',
    'Google Drive'],
    [`now => sum(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'get the sum of the file size in files in your Google Drive',
    'Google Drive'],
    [`now => count(file_size of @com.google.drive.list_drive_files()) => notify;`,
    'get the number of file sizes in files in your Google Drive',
    'Google Drive'],
    [`now => count(file_name of @com.google.drive.list_drive_files()) => notify;`,
    'get the number of file names in files in your Google Drive',
    'Google Drive'],
    [`now => count(@com.google.drive.list_drive_files()) => notify;`,
    'get the number of files in your Google Drive',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[1] => notify;`,
    'get the files in your Google Drive with the minimum file size',
    'Google Drive'],
    [`now => sort(file_size desc of @com.google.drive.list_drive_files())[-1] => notify;`,
    'get the files in your Google Drive with the minimum file size',
    'Google Drive'],
    [`now => sort(file_size desc of @com.google.drive.list_drive_files())[1] => notify;`,
    'get the files in your Google Drive with the maximum file size',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[-1] => notify;`,
    'get the files in your Google Drive with the maximum file size',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[-1:5] => notify;`,
    'get the 5 files in your Google Drive with the maximum file size',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[1:5] => notify;`,
    'get the 5 files in your Google Drive with the minimum file size',
    'Google Drive'],
    [`now => sort(file_size asc of @com.google.drive.list_drive_files())[1:$?] => notify;`,
    'get the ____ files in your Google Drive with the minimum file size',
    'Google Drive'],
    [`now => sort(file_size desc of @com.google.drive.list_drive_files())[1:$?] => notify;`,
    'get the ____ files in your Google Drive with the maximum file size',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[1] => notify;`,
    'get the first files in your Google Drive',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[-1] => notify;`,
    'get the last files in your Google Drive',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[$?] => notify;`,
    'get the files in your Google Drive with index ____',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[1:$?] => notify;`,
    'get the first ____ files in your Google Drive',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[-1:$?] => notify;`,
    'get the last ____ files in your Google Drive',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[1:5] => notify;`,
    'get the first 5 files in your Google Drive',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[-1:5] => notify;`,
    'get the last 5 files in your Google Drive',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[2:5] => notify;`,
    'get 5 elements starting from 2 of the files in your Google Drive',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[-2:5] => notify;`,
    'get 5 elements starting from -2 of the files in your Google Drive',
    'Google Drive'],
    [`now => @com.google.drive.list_drive_files()[1, 2, 7] => notify;`,
    'get elements 1, 2, and 7 of the files in your Google Drive',
    'Google Drive'],

    [`now => [file_name] of sort(file_size asc of @com.google.drive.list_drive_files()) => notify;`,
    'get the file name of the files in your Google Drive sorted by increasing file size',
    'Google Drive'],

    [`$yes;`,
    'yes', ''],

    [`$no;`,
    'no', ''],

    [`$nevermind;`,
    'cancel', ''],

    [`$answer(42);`,
    '42', ''],

    [`$choice(0);`,
    'choice number 1', ''],

    [`now => @com.spotify.get_currently_playing() => @com.spotify.add_songs_to_playlist(toAdd=song);`,
    'get the currently playing track name and then add the songs the song to the playlist ____', 'Spotify ⇒ Spotify'],
    [`attimer(time=$?) => @com.twitter.post();`,
    `tweet ____ every day at ____`, 'Twitter'],
    [`now => @com.twitter.post(status = $context.selection : String);`,
    `tweet the selection on the screen`, `Twitter`],

    [`#[executor = "bob"^^tt:username] now => @com.twitter.post(status="lol");`,
    `tell @bob: tweet “lol”`, `Twitter`],

    [`#[executor = "bob"^^tt:username] monitor(@security-camera.current_event()) => @com.twitter.post(status="lol");`,
    `tell @bob: tweet “lol” when the current event detected on your security camera changes`,
    `Security Camera ⇒ Twitter`],

    [`#[executor = "bob"^^tt:username] monitor(@security-camera.current_event()) => @com.yandex.translate.translate(text="lol") => @com.twitter.post(status=translated_text);`,
    `tell @bob: do the following: when the current event detected on your security camera changes, get the translation of “lol” to ____, and then tweet the translated text`,
    `Security Camera ⇒ Yandex Translate ⇒ Twitter`],

    [`(monitor (@org.thingpedia.weather.current(location=$?))) filter temperature >= 5defaultTemperature => notify;`,
    'notify you when the current weather for ____ changes and it becomes true that the temperature is greater than or equal to 5 degrees', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10defaultTemperature => notify;`,
    'get the current weather for ____ such that the temperature is greater than or equal to 10 degrees', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10.2defaultTemperature => notify;`,
    'get the current weather for ____ such that the temperature is greater than or equal to 10.2 degrees', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10.33defaultTemperature => notify;`,
    'get the current weather for ____ such that the temperature is greater than or equal to 10.3 degrees', 'Weather'],

    [`now => (@com.yelp.restaurant()), true(cuisines) => notify;`,
    `get restaurants on Yelp such that any value of cuisines is acceptable`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) => notify;`,
    `get restaurants on Yelp that have Mexican food`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) && price == enum(cheap) => notify;`,
    `get cheap restaurants on Yelp that have Mexican food`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) && rating == 4 => notify;`,
    `get restaurants on Yelp rated 4 star that have Mexican food`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) && rating >= 4 => notify;`,
    `get restaurants on Yelp that have Mexican food such that the rating is greater than or equal to 4`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) && geo == new Location("Palo Alto") => notify;`,
    `get restaurants on Yelp that have Mexican food near Palo Alto`,
    `Yelp`],

    [`now => (@com.yelp.restaurant()), geo == new Location("Palo Alto") && contains(cuisines, "mexican"^^com.yelp:restaurant_cuisine("Mexican")) => notify;`,
    `get restaurants on Yelp that have Mexican food near Palo Alto`,
    `Yelp`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(, 6, ) => notify;`,
     `get today's date such that the date is after start of day on day 1 of june, this year`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(, 6, , 12, 0, 0) => notify;`,
     `get today's date such that the date is after 12:00 PM on day 1 of june, this year`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(2020, 6, ) => notify;`,
     `get today's date such that the date is after Monday, June 1, 2020`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(2020, 6, , 12, 0, 0) => notify;`,
     `get today's date such that the date is after 6/1/2020, 12:00:00 PM`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(, 6, 3, 12, 0, 0) => notify;`,
     `get today's date such that the date is after 12:00 PM on day 3 of june, this year`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(, 6, 3) => notify;`,
     `get today's date such that the date is after start of day on day 3 of june, this year`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(enum monday) => notify;`,
     `get today's date such that the date is after start of day on monday`,
     `Get Date`],

    [`now => @org.thingpedia.builtin.thingengine.builtin.get_date(), date >= new Date(enum monday, 12, 0, 0) => notify;`,
     `get today's date such that the date is after 12:00 PM on monday`,
     `Get Date`]
];

const gettext = {
    locale: 'en-US',
    dgettext: (domain, msgid) => msgid,
    dngettext: (domain, msgid, msgid_plural, n) => n === 1 ? msgid : msgid_plural,
};

async function test(i) {
    console.log('Test Case #' + (i+1));
    let [code, expected, expectedname] = TEST_CASES[i];

    let failed = false;
    try {
        const prog = await Syntax.parse(code).typecheck(schemaRetriever, true);
        const describer = new Describer(gettext, 'en-US', 'America/Los_Angeles');
        let reconstructed = describer.describe(prog);
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
