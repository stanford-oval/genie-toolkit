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
    'Tweet the text when there are new Twitter home timeline.',
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
    `Send me a message it's the evening every 2 hours.`,//'
    'Say'],
    [`timer(base=new Date(), interval=2h, frequency=2) => @org.thingpedia.builtin.thingengine.builtin.say(message="it's the evening");`,
    `Send me a message it's the evening 2 times every 2 hours.`,//'
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
    `Post on Facebook with status the snippet when there are new list email in inbox if the labels contain work.`,
    'Gmail ⇒ Facebook'],
    [`monitor (@com.gmail.inbox(), contains(labels, "work")) => @com.facebook.post(status=snippet);`,
    `Post on Facebook with status the snippet when there are new list email in inbox if the labels contain work.`,
    'Gmail ⇒ Facebook'],
    [`monitor (@com.gmail.inbox(), !contains(labels, "work")) => @com.facebook.post(status=snippet);`,
    `Post on Facebook with status the snippet when there are new list email in inbox if the labels don't contain work.`,
    'Gmail ⇒ Facebook'],

    ['monitor(@com.twitter.home_timeline(), contains~(hashtags, "funny")) => @com.twitter.post(status=text);',
    'Tweet the text when there are new Twitter home timeline if the hashtags contain funny.',
    'Twitter ⇒ Twitter'],
    ['monitor(@com.twitter.home_timeline(), text =~ "funny") => @com.twitter.post(status=text);',
    'Tweet the text when there are new Twitter home timeline if the text contains funny.',
    'Twitter ⇒ Twitter'],
    ['monitor(@com.twitter.home_timeline(), !(text =~ "funny")) => @com.twitter.post(status=text);',
    'Tweet the text when there are new Twitter home timeline if the text doesn\'t contain funny.',
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
    'Get the translate on ytranslate with target language Italian and text the result when there are new web searches on bing.',
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
    'Notify me when the current weather in ____ changes and it becomes true that the temperature is greater than or equal to 5 degrees Fahrenheit.', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10defaultTemperature => notify;`,
    'Get the current weather in ____ such that the temperature is greater than or equal to 10 degrees Fahrenheit.', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10.2defaultTemperature => notify;`,
    'Get the current weather in ____ such that the temperature is greater than or equal to 10 degrees Fahrenheit.', 'Weather'],
    [`now => (@org.thingpedia.weather.current(location=$?)), temperature >= 10.33defaultTemperature => notify;`,
    'Get the current weather in ____ such that the temperature is greater than or equal to 10 degrees Fahrenheit.', 'Weather'],

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

    [`timer(base=$now, interval=1h) => @org.thingpedia.iot.light-bulb(id="io.home-assistant/lights.living_room_1"^^tt:device_id("Living Room")).set_power(power=enum off);`,
    'Shut down the Living Room lights every 60 minutes.',
    'Light Bulb'],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.spotify2.playable() filter contains(artists, null^^com.spotify2:artist("roddy ricch")) && id =~ "box";`,
    `Get box by roddy ricch.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.spotify2.song() filter contains(artists, null^^com.spotify2:artist("roddy ricch")) && id =~ "box";`,
    `Get the song box by roddy ricch.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.spotify2.playable() filter contains(artists, null^^com.spotify2:artist("roddy ricch")) && id =~ "box" => @com.spotify2.play(playable=id);`,
    `Play box by roddy ricch on Spotify.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    ontimer(date=[set_time($now, new Time(12, 35))]) => @com.spotify2.playable() filter contains(artists, null^^com.spotify2:artist("roddy ricch")) && id =~ "box" => @com.spotify2.play(playable=id);`,
    `Play box by roddy ricch on Spotify at 12:35 PM today.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    ontimer(date=[set_time($now, new Time(12, 35))]) => @org.thingpedia.builtin.thingengine.builtin.alert();`,
    `Alert at 12:35 PM today.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    ontimer(date=[set_time($end_of(day), new Time(12, 35))]) => @org.thingpedia.builtin.thingengine.builtin.alert();`,
    `Alert at 12:35 PM tomorrow.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    ontimer(date=[set_time($start_of(day), new Time(12, 35))]) => @org.thingpedia.builtin.thingengine.builtin.alert();`,
    `Alert at 12:35 PM today.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    ontimer(date=[set_time(new Date("2022-08-12T00:00:00.000-07:00"), new Time(12, 35))]) => @org.thingpedia.builtin.thingengine.builtin.alert();`,
    `Alert at 12:35 PM on August 12.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    ontimer(date=[set_time($start_of(week), new Time(12, 35))]) => @org.thingpedia.builtin.thingengine.builtin.alert();`,
    `Alert at 12:35 PM on the start of this week.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    ontimer(date=[$now + 5min]) => @org.thingpedia.builtin.thingengine.builtin.alert();`,
    `Alert in 5 minutes.`,
    ``],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    now => (@com.spotify2.song(), id =~ ("despacito")) => @com.spotify2.play(playable=id);`,
    'Play the song despacito on Spotify.',
    `Spotify2 ⇒ Spotify2`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    now => (@com.spotify2.song(), id =~ ("despacito"))[1] => @com.spotify2.play(playable=id);`,
    'Play the song despacito on Spotify.',
    `Spotify2 ⇒ Spotify2`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    now => (@com.spotify2.playable(), id =~ ("despacito"))[1] => @com.spotify2.play(playable=id);`,
    'Play despacito on Spotify.',
    `Spotify2 ⇒ Spotify2`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.yelp.restaurant(), phone == "+1123456789"^^tt:phone_number;`,
    'Get restaurants such that the phone number is equal to (123) 456-789.',
    `Yelp`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.yelp.restaurant(), phone == "+39123456789"^^tt:phone_number;`,
    'Get restaurants such that the phone number is equal to +39123456789.',
    `Yelp`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.yelp.restaurant(), openingHours == new RecurrentTimeSpecification({ beginTime=new Time(8,0), endTime=new Time(18,0) });`,
    'Get restaurants such that the opening hours is equal to from 8:00 AM to 6:00 PM every day.',
    `Yelp`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.yelp.restaurant(), openingHours == new RecurrentTimeSpecification({ beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum monday }, { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum tuesday });`,
    'Get restaurants such that the opening hours is equal to from 8:00 AM to 6:00 PM on Monday and Tuesday.',
    `Yelp`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.yelp.restaurant(), openingHours == new RecurrentTimeSpecification(
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum monday },
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum tuesday },
        { beginTime=new Time(15,0), endTime=new Time(18,0), dayOfWeek=enum saturday },
        { beginTime=new Time(15,0), endTime=new Time(18,0), dayOfWeek=enum sunday }
        );`,
    'Get restaurants such that the opening hours is equal to from 8:00 AM to 6:00 PM on Monday and Tuesday and from 3:00 PM to 6:00 PM on Saturday and Sunday.',
    `Yelp`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.yelp.restaurant(), openingHours == new RecurrentTimeSpecification(
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum monday },
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum tuesday },
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum wednesday },
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum thursday },
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum friday });`,
    'Get restaurants such that the opening hours is equal to from 8:00 AM to 6:00 PM Monday to Friday.',
    `Yelp`],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
    @com.yelp.restaurant(), openingHours == new RecurrentTimeSpecification(
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum monday },
        { beginTime=new Time(8,0), endTime=new Time(18,0), dayOfWeek=enum tuesday },
        { beginTime=new Time(15,0), endTime=new Time(18,0), dayOfWeek=enum monday, beginDate=new Date(2023,12,25), endDate=new Date(2023,12,25) },
        { beginTime=new Time(15,0), endTime=new Time(18,0), dayOfWeek=enum tuesday, beginDate=new Date(2023,12,25), endDate=new Date(2023,12,25) }
        );`,
    'Get restaurants such that the opening hours is equal to from 8:00 AM to 6:00 PM on Monday and Tuesday, from 3:00 PM to 6:00 PM on Monday between December 25, 2023 and December 25, 2023, and from 3:00 PM to 6:00 PM on Tuesday between December 25, 2023 and December 25, 2023.',
    `Yelp`],

    [` @org.thingpedia.builtin.test(id="org.thingpedia.builtin.test").eat_data(data="some data ");`,
    `Eat data on test with data some data.`,
    `Test`],

    [`monitor(@org.thingpedia.iot.switch.state());`,
    `Notify me when the switch state changes.`,
    `Switch`],

    [`monitor(@org.thingpedia.iot.switch(name="kitchen").state());`,
    `Notify me when the power state of my kitchen switch changes.`,
    `Switch`],

    [`monitor(@org.thingpedia.iot.switch(id="switch-kitchen"^^tt:device_id("Kitchen Switches")).state());`,
    `Notify me when the power state of my Kitchen Switches switch changes.`,
    `Switch`]
];

async function test(i) {
    console.log('Test Case #' + (i+1));
    let [code, expected, expectedname] = TEST_CASES[i];

    const langPack = I18n.get('en-US');
    const timezone = 'America/Los_Angeles';

    let failed = false;
    try {
        const prog = await Syntax.parse(code, Syntax.SyntaxType.Normal, { timezone }).typecheck(schemaRetriever, true);
        const allocator = new Syntax.SequentialEntityAllocator({}, { timezone });
        const describer = new Describer('en-US', timezone, allocator);
        // retrieve the relevant primitive templates
        const kinds = new Set();
        for (const [, prim] of prog.iteratePrimitives(false))
            kinds.add(prim.selector.kind);
        for (const kind of kinds) {
            const dataset = await schemaRetriever.getExamplesByKind(kind);
            describer.setDataset(kind, dataset);
        }

        let reconstructed = describer.describe(prog).chooseBest();
        reconstructed = langPack.postprocessNLG(langPack.postprocessSynthetic(reconstructed, prog, null, 'agent'), allocator.entities, {
            timezone,
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
