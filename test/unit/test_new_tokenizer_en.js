// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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

import * as I18n from '../../lib/i18n';

const TEST_CASES = [
    // order is input, raw, processed, entities, detokenized

    // basics: splitting on spaces, casing, punctuation, emojis
    ['post on twitter', 'post on twitter', 'post on twitter', {}],
    ['post    on      twitter', 'post on twitter', 'post on twitter', {}],
    ['post    on \n \t   twitter', 'post on twitter', 'post on twitter', {}],
    ['Post on Twitter.', 'post on twitter .', 'post on twitter .', {}],
    ['Post on Twitter???', 'post on twitter ? ? ?', 'post on twitter ? ? ?', {}],
    ['Post 😗 on Twitter', 'post 😗 on twitter', 'post 😗 on twitter', {}],
    ['make a twitter-post', 'make a twitter-post', 'make a twitter-post', {}],
    ['make a twitter-', 'make a twitter -', 'make a twitter -', {}],
    ['created // by', 'created // by', 'created // by', {}],

    // numbers and words together
    ['train tr0123', 'train tr0123', 'train tr0123', {}],
    ['train tr-0123', 'train tr- 123', 'train tr- 123', {}],
    ['abc123def', 'abc123def', 'abc123def', {}],
    ['5kW', '5 kw', '5 kw', {}],
    ['9gag', '9 gag', '9 gag', {}],
    ['9-gag', '9 -gag', '9 -gag', {}],

    // more complex emojis (multiple codepoints with ZWJ, skin token modifiers, etc.)
    // two bros with their smaller bros
    ['👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦', {}],
    ['\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}', '👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦', {}],
    // two very good friends
    ['\u{1F469}\u200D\u2764\uFE0F\u{200D}\u{1F469}', '👩‍❤️‍👩', '👩‍❤️‍👩', {}],
    // trans rights
    ['\u{1F3F3}\u{FE0F}\u{200D}\u{26A7}\u{FE0F}', '🏳️‍⚧️', '🏳️‍⚧️', {}],
    // cat
    ['\u{1F408}\u{200D}\u{2B1B}', '🐈‍⬛', '🐈‍⬛', {}],

    // placeholders (for Thingpedia)
    ['post ____ on Twitter', 'post ____ on twitter', 'post ____ on twitter', {}],
    ['post ____,____ on Twitter', 'post ____ , ____ on twitter', 'post ____ , ____ on twitter', {}],

    // abbreviations
    ['so e.g. this is a sentence, ie. something you type',
     'so e.g. this is a sentence , ie. something you type',
     'so e.g. this is a sentence , ie. something you type', {}],
    ['Prof. Monica S. Lam, Ph.D',
     'prof. monica s. lam , ph.d',
     'prof. monica s. lam , ph.d', {}],
    ['dr. so and so , m.d.',
     'dr. so and so , m.d.',
     'dr. so and so , m.d.',
     {}],
    ['apple computers inc., microsoft corp., another company ltd.',
     'apple computers inc. , microsoft corp. , another company ltd.',
     'apple computers inc. , microsoft corp. , another company ltd.',
     {}],

    // quoted strings
    ['tweet "hello"', 'tweet “hello”', 'tweet QUOTED_STRING_0', { QUOTED_STRING_0: 'hello' }],
    ['tweet "hello world"', 'tweet “hello world”', 'tweet QUOTED_STRING_0', { QUOTED_STRING_0: 'hello world' }],
    ['tweet "  "  "', 'tweet “  ” "', 'tweet QUOTED_STRING_0 "', { QUOTED_STRING_0: '  ' }],
    ['tweet "foo"  "', 'tweet “foo” "', 'tweet QUOTED_STRING_0 "', { QUOTED_STRING_0: 'foo' }],
    ['tweet "  "foo"', 'tweet “  ” foo "', 'tweet QUOTED_STRING_0 foo "', { QUOTED_STRING_0: '  ' }],

    // hashtags
    ['get a #cat gif', 'get a #cat gif', 'get a HASHTAG_0 gif', { HASHTAG_0: 'cat' }],
    ['get a #cat and#dog gif', 'get a #cat and #dog gif', 'get a HASHTAG_0 and HASHTAG_1 gif', { HASHTAG_0: 'cat', HASHTAG_1: 'dog' }],
    ['get a #cat and#cat gif', 'get a #cat and #cat gif', 'get a HASHTAG_0 and HASHTAG_0 gif', { HASHTAG_0: 'cat' }],

    // usernames
    ['call @mom', 'call @mom', 'call USERNAME_0', { USERNAME_0: 'mom' }],
    ['call @mom.', 'call @mom .', 'call USERNAME_0 .', { USERNAME_0: 'mom' }],
    ['call @mom, @dad', 'call @mom , @dad', 'call USERNAME_0 , USERNAME_1', { USERNAME_0: 'mom', USERNAME_1: 'dad' }],

    // phone numbers
    ['call +123456789', 'call +123456789', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+123456789' }],
    ['call 1-800-almond', 'call +1800256663', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+1800256663' }],
    ['call 650 123 4567', 'call +16501234567', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+16501234567' }],
    ['call 650 1234567', 'call +16501234567', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+16501234567' }],
    ['call 6501234567', 'call +16501234567', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+16501234567' }],
    // not phone numbers
    ['call 1000 almonds', 'call 1000 almonds', 'call 1000 almonds', {}],

    // urls
    ['open www.google.com', 'open http://www.google.com', 'open URL_0', { URL_0: 'http://www.google.com' }],
    ['open google.com', 'open http://google.com', 'open URL_0', { URL_0: 'http://google.com' }],
    ['open www.stanford.edu', 'open http://www.stanford.edu', 'open URL_0', { URL_0: 'http://www.stanford.edu' }],
    ['open almond.stanford.edu', 'open http://almond.stanford.edu', 'open URL_0', { URL_0: 'http://almond.stanford.edu' }],
    ['open http://www.google.com', 'open http://www.google.com', 'open URL_0', { URL_0: 'http://www.google.com' }],
    ['open http://google.com', 'open http://google.com', 'open URL_0', { URL_0: 'http://google.com' }],
    ['open https://google.com', 'open https://google.com', 'open URL_0', { URL_0: 'https://google.com' }],
    ['open sftp://google.com', 'open sftp://google.com', 'open URL_0', { URL_0: 'sftp://google.com' }],
    ['open https://foo.bar/A/B?lol,', 'open https://foo.bar/A/B?lol ,', 'open URL_0 ,', { URL_0: 'https://foo.bar/A/B?lol' }],
    ['open (https://foo.bar/A/B?lol)', 'open ( https://foo.bar/A/B?lol)', 'open ( URL_0', { URL_0: 'https://foo.bar/A/B?lol)' }],
    ['open <https://foo.bar/A/B?lol>', 'open < https://foo.bar/A/B?lol >', 'open < URL_0 >', { URL_0: 'https://foo.bar/A/B?lol' }],
    ['open <www.example.com>', 'open < http://www.example.com >', 'open < URL_0 >', { URL_0: 'http://www.example.com' }],
    ['open https://google.com.', 'open https://google.com.', 'open URL_0', { URL_0: 'https://google.com.' }],
    ['open www.google.com.', 'open http://www.google.com .', 'open URL_0 .', { URL_0: 'http://www.google.com' }],

    // email addresses
    ['send mail to bob@gmail.com', 'send mail to bob@gmail.com', 'send mail to EMAIL_ADDRESS_0', { EMAIL_ADDRESS_0: 'bob@gmail.com' }],
    ['send mail to me+you@gmail.com', 'send mail to me+you@gmail.com', 'send mail to EMAIL_ADDRESS_0', { EMAIL_ADDRESS_0: 'me+you@gmail.com' }],
    ['send mail to bob@somewhere', 'send mail to bob @somewhere', 'send mail to bob USERNAME_0', { USERNAME_0: 'somewhere' }],

    // zipcodes
    ['353 serra mall, stanford ca. 94305', '353 serra mall , stanford ca . 94305', '353 serra mall , stanford ca . 94305', {}],
    ['campus dr. 94305', 'campus dr. 94305', 'campus dr. 94305', {}],

    // apostrophes and contractions
    ['what\'s the weather in barcelona', 'what \'s the weather in barcelona', 'what \'s the weather in barcelona', {}],
    ['i won\'t tell you that', 'i won\'t tell you that', 'i won\'t tell you that', {}],
    ['i won\'ttypo', 'i won \'ttypo', 'i won \'ttypo', {}],
    ['don\'t be sad!', 'don\'t be sad !', 'don\'t be sad !', {}],
    ['i\'m happy, you\'re happy, and they\'re sad', 'i \'m happy , you \'re happy , and they \'re sad', 'i \'m happy , you \'re happy , and they \'re sad', {}],

    // numbers and measurements
    ['more than zero', 'more than zero', 'more than zero', {}],
    ['more than 0', 'more than 0', 'more than 0', {}],
    ['at least 3gb', 'at least 3 gb', 'at least 3 gb', {}],
    ['at least 25gb', 'at least 25 gb', 'at least 25 gb', {}],
    ['at least -3gb', 'at least -3 gb', 'at least -3 gb', {}],
    ['at least -25gb', 'at least -25 gb', 'at least -25 gb', {}],
    ['at least 1.75 gb', 'at least 1.75 gb', 'at least 1.75 gb', {}],
    ['at least 1.75, and then some more', 'at least 1.75 , and then some more', 'at least 1.75 , and then some more', {}],
    ['at least 25, and then some more', 'at least 25 , and then some more', 'at least 25 , and then some more', {}],
    ['at least 25,000 and then some more', 'at least 25000 and then some more', 'at least 25000 and then some more', {}],
    ['at least 25,00 and then some more', 'at least 2500 and then some more', 'at least 2500 and then some more', {}],
    ['at least one', 'at least one', 'at least one', {}],
    ['at least five', 'at least 5', 'at least 5', {}],
    ['at least twelve', 'at least 12', 'at least 12', {}],
    ['at least thirteen', 'at least 13', 'at least 13', {}],
    ['at least twenty', 'at least 20', 'at least 20', {}],
    ['at least twenty, one', 'at least 20 , one', 'at least 20 , one', {}],
    ['at least twenty one', 'at least 21', 'at least 21', {}],
    ['at least twenty-one', 'at least 21', 'at least 21', {}],
    ['at least twenty-two', 'at least 22', 'at least 22', {}],
    ['at least twenty-nine', 'at least 29', 'at least 29', {}],
    ['at least ninety one', 'at least 91', 'at least 91', {}],
    ['at least one million', 'at least 1000000', 'at least 1000000', {}],
    ['at least one million two thousands and three', 'at least 1002003', 'at least 1002003', {}],
    ['at least 1.75 billions', 'at least 1750000000', 'at least 1750000000', {}],
    ['at least a hundred', 'at least 100', 'at least 100', {}],
    ['at least a thousand', 'at least 1000', 'at least 1000', {}],
    ['at least twenty two hundreds', 'at least 2200', 'at least 2200', {}],
    ['at least twenty three hundreds forty five', 'at least 2345', 'at least 2345', {}],
    ['at least three hundred thousands', 'at least 300000', 'at least 300000', {}],
    ['at least three hundred fifteen thousands', 'at least 315000', 'at least 315000', {}],
    ['more than a hundred seventy reviews', 'more than 170 reviews', 'more than 170 reviews', {}],

    // ordinals
    ['i want the 1st', 'i want the 1st', 'i want the 1st', {}],
    ['i want the 13th', 'i want the 13th', 'i want the 13th', {}],
    ['i want the 21st', 'i want the 21st', 'i want the 21st', {}],
    ['i want the 21sta', 'i want the 21 sta', 'i want the 21 sta', {}],
    ['i want the 21rd', 'i want the 21 rd', 'i want the 21 rd', {}],
    ['i want the first', 'i want the first', 'i want the first', {}],
    ['i want the fifth', 'i want the fifth', 'i want the fifth', {}],
    ['i want the twelfth', 'i want the twelfth', 'i want the twelfth', {}],
    ['i want the thirteenth', 'i want the 13th', 'i want the 13th', {}],
    ['i want the twentieth', 'i want the 20th', 'i want the 20th', {}],
    ['i want the twenty, first', 'i want the 20 , first', 'i want the 20 , first', {}],
    ['i want the twenty first', 'i want the 21st', 'i want the 21st', {}],
    ['i want the twenty-first', 'i want the 21st', 'i want the 21st', {}],
    ['i want the twenty-second', 'i want the 22nd', 'i want the 22nd', {}],
    ['i want the twenty-ninth', 'i want the 29th', 'i want the 29th', {}],
    ['i want the ninety first', 'i want the 91st', 'i want the 91st', {}],
    ['i want the millionth', 'i want the 1000000th', 'i want the 1000000th', {}],
    ['i want the one million two thousands and third', 'i want the 1002003rd', 'i want the 1002003rd', {}],
    ['i want the two billionth', 'i want the 2000000000th', 'i want the 2000000000th', {}],
    ['i want the hundredth', 'i want the 100th', 'i want the 100th', {}],
    ['i want the thousandth', 'i want the 1000th', 'i want the 1000th', {}],
    ['i want the twenty two hundredth', 'i want the 2200th', 'i want the 2200th', {}],
    ['i want the twenty three hundreds forty fifth', 'i want the 2345th', 'i want the 2345th', {}],
    ['i want the three hundred thousandth', 'i want the 300000th', 'i want the 300000th', {}],
    ['i want the three hundred fifteen thousandth', 'i want the 315000th', 'i want the 315000th', {}],
    ['i want the three hundred fifteen thousand and second', 'i want the 315002nd', 'i want the 315002nd', {}],

    // currencies
    ['it costs $50', 'it costs 50 usd', 'it costs CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['it costs $ 50', 'it costs 50 usd', 'it costs CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['it costs $1,000', 'it costs 1000 usd', 'it costs CURRENCY_0', { CURRENCY_0: { value: 1000, unit: 'usd' }}],
    ['it costs C$50', 'it costs 50 cad', 'it costs CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'cad' }}],
    ['it costs €50', 'it costs 50 eur', 'it costs CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'eur' }}],
    ['it costs 50 dollars', 'it costs 50 usd', 'it costs CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['it costs 50 bucks', 'it costs 50 usd', 'it costs CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['it costs 50 euro', 'it costs 50 eur', 'it costs CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'eur' }}],
    ['it costs 50 yuan', 'it costs 50 cny', 'it costs CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'cny' }}],

    // times

    // am marker
    ['wake me up at 7am', 'wake me up at 7:00:00', 'wake me up at TIME_0', { TIME_0: { hour: 7, minute: 0, second: 0 } }],
    ['wake me up at 7am in the morning', 'wake me up at 7:00:00 in the morning', 'wake me up at TIME_0 in the morning', { TIME_0: { hour: 7, minute: 0, second: 0 } }],
    ['wake me up at 7a.m. in the morning', 'wake me up at 7:00:00 in the morning', 'wake me up at TIME_0 in the morning', { TIME_0: { hour: 7, minute: 0, second: 0 } }],
    ['wake me up at 7 o\'clock in the morning', 'wake me up at 7:00:00 in the morning', 'wake me up at TIME_0 in the morning', { TIME_0: { hour: 7, minute: 0, second: 0 } }],
    ['wake me up at 7 o\' clock in the morning', 'wake me up at 7:00:00 in the morning', 'wake me up at TIME_0 in the morning', { TIME_0: { hour: 7, minute: 0, second: 0 } }],
    ['wake me up at 7:15 in the morning', 'wake me up at 7:15:00 in the morning', 'wake me up at TIME_0 in the morning', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['wake me up at 7:15am in the morning', 'wake me up at 7:15:00 in the morning', 'wake me up at TIME_0 in the morning', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['wake me up at 7:15am', 'wake me up at 7:15:00', 'wake me up at TIME_0', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['wake me up at 7:15:22 in the morning', 'wake me up at 7:15:22 in the morning', 'wake me up at TIME_0 in the morning', { TIME_0: { hour: 7, minute: 15, second: 22 } }],
    ['wake me up at 7:15:22am', 'wake me up at 7:15:22', 'wake me up at TIME_0', { TIME_0: { hour: 7, minute: 15, second: 22 } }],
    ['a checkin time of 02:00 AM', 'a checkin time of 2:00:00', 'a checkin time of TIME_0', { TIME_0: { hour: 2, minute: 0, second: 0 } }],

    // pm marker
    ['wake me up at 7pm', 'wake me up at 19:00:00', 'wake me up at TIME_0', { TIME_0: { hour: 19, minute: 0, second: 0 } }],
    ['wake me up at 7pm in the afternoon', 'wake me up at 19:00:00 in the afternoon', 'wake me up at TIME_0 in the afternoon', { TIME_0: { hour: 19, minute: 0, second: 0 } }],
    ['wake me up at 7p.m. in the afternoon', 'wake me up at 19:00:00 in the afternoon', 'wake me up at TIME_0 in the afternoon', { TIME_0: { hour: 19, minute: 0, second: 0 } }],
    ['wake me up at 7 o\'clock in the afternoon', 'wake me up at 19:00:00 in the afternoon', 'wake me up at TIME_0 in the afternoon', { TIME_0: { hour: 19, minute: 0, second: 0 } }],
    ['wake me up at 7 o\' clock in the afternoon', 'wake me up at 19:00:00 in the afternoon', 'wake me up at TIME_0 in the afternoon', { TIME_0: { hour: 19, minute: 0, second: 0 } }],
    ['wake me up at 7:15 in the afternoon', 'wake me up at 19:15:00 in the afternoon', 'wake me up at TIME_0 in the afternoon', { TIME_0: { hour: 19, minute: 15, second: 0 } }],
    ['wake me up at 7:15 in the evening', 'wake me up at 19:15:00 in the evening', 'wake me up at TIME_0 in the evening', { TIME_0: { hour: 19, minute: 15, second: 0 } }],
    ['wake me up at 7:15pm in the afternoon', 'wake me up at 19:15:00 in the afternoon', 'wake me up at TIME_0 in the afternoon', { TIME_0: { hour: 19, minute: 15, second: 0 } }],
    ['wake me up at 7:15pm', 'wake me up at 19:15:00', 'wake me up at TIME_0', { TIME_0: { hour: 19, minute: 15, second: 0 } }],
    ['wake me up at 7:15:22 in the afternoon', 'wake me up at 19:15:22 in the afternoon', 'wake me up at TIME_0 in the afternoon', { TIME_0: { hour: 19, minute: 15, second: 22 } }],
    ['wake me up at 7:15:22pm', 'wake me up at 19:15:22', 'wake me up at TIME_0', { TIME_0: { hour: 19, minute: 15, second: 22 } }],
    ['a checkin time of 02:00 PM', 'a checkin time of 14:00:00', 'a checkin time of TIME_0', { TIME_0: { hour: 14, minute: 0, second: 0 } }],

    // no markers
    ['wake me up at 7:15', 'wake me up at 7:15:00', 'wake me up at TIME_0', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['wake me up at 7:15:00', 'wake me up at 7:15:00', 'wake me up at TIME_0', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['wake me up at 3:15', 'wake me up at 3:15:00', 'wake me up at TIME_0', { TIME_0: { hour: 3, minute: 15, second: 0 } }],
    ['wake me up at 15:15', 'wake me up at 15:15:00', 'wake me up at TIME_0', { TIME_0: { hour: 15, minute: 15, second: 0 } }],
    ['wake me up at 19:15', 'wake me up at 19:15:00', 'wake me up at TIME_0', { TIME_0: { hour: 19, minute: 15, second: 0 } }],

    // ambiguous cases are handled by the parser (treated as "small numbers")
    ['wake me up at 7', 'wake me up at 7', 'wake me up at 7', {}],
    ['wake me up at 7 in the morning', 'wake me up at 7 in the morning', 'wake me up at 7 in the morning', {}],
    ['wake me up at 7 in the afternoon', 'wake me up at 7 in the afternoon', 'wake me up at 7 in the afternoon', {}],

    // dates
    ['june 1st', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st 2020', '2020-06-01', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 2020', '2020-06-01', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['december 1st', 'XXXX-12-01', 'DATE_0', { DATE_0: { year: -1, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['december 1st 2020', '2020-12-01', 'DATE_0', { DATE_0: { year: 2020, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['december 1st, 2020', '2020-12-01', 'DATE_0', { DATE_0: { year: 2020, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['apr. 3rd', 'XXXX-04-03', 'DATE_0', { DATE_0: { year: -1, month: 4, day: 3, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['apr. 3rd 2020', '2020-04-03', 'DATE_0', { DATE_0: { year: 2020, month: 4, day: 3, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['apr. 3rd, 2020', '2020-04-03', 'DATE_0', { DATE_0: { year: 2020, month: 4, day: 3, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['may 5', 'XXXX-05-05', 'DATE_0', { DATE_0: { year: -1, month: 5, day: 5, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['may 5 2020', '2020-05-05', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 5, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['may 5 2020', '2020-05-05', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 5, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['1st of june', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['1st of june, 2020', '2020-06-01', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['2nd of june, 2020', '2020-06-02', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 2, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['3rd of june, 2020', '2020-06-03', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 3, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['23rd of june, 2020', '2020-06-23', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 23, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['june 2020', '2020-06-XX', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: -1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['june 2020, somewhere', '2020-06-XX , somewhere', 'DATE_0 , somewhere', { DATE_0: { year: 2020, month: 6, day: -1, hour: 0, minute: 0, second: 0, timezone: undefined } }],

    // with times
    ['june 1st at 7:15am', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 7:15 in the morning', 'XXXX-06-01T07:15:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 7am', 'XXXX-06-01T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st at 7 o\'clock', 'XXXX-06-01T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st at 7 o\'clock in the morning', 'XXXX-06-01T07:00:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 7:15am', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],

    ['june 1st, 7:15pm', 'XXXX-06-01T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 7:15 in the afternoon', 'XXXX-06-01T19:15:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 7:15pm', 'XXXX-06-01T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 7pm', 'XXXX-06-01T19:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st at 7 o\'clock in the afternoon', 'XXXX-06-01T19:00:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 7:15pm', 'XXXX-06-01T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],

    ['june 1st at 0715', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 0715hrs', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    // note: "june 1st, 0715" would parse "715" as year
    ['june 1st, 0715hrs', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 0315', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 0315hrs', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 0315hrs', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 7:15', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 7 o\'clock', 'XXXX-06-01T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st at 3:15', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st at 3 o\'clock', 'XXXX-06-01T03:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 0, second: 0, timezone: undefined } }],

    // again, with years
    ['june 1st, 2020 at 7:15am', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7:15 in the morning', '2020-06-01T07:15:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7am', '2020-06-01T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7 o\'clock', '2020-06-01T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7 o\'clock in the morning', '2020-06-01T07:00:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 2020, 7:15am', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],

    ['june 1st, 2020, 7:15pm', '2020-06-01T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020, 7:15 in the afternoon', '2020-06-01T19:15:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7:15pm', '2020-06-01T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7pm', '2020-06-01T19:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7 o\'clock in the afternoon', '2020-06-01T19:00:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 2020, 7:15pm', '2020-06-01T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],

    ['june 1st, 2020 at 0715', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 0715hrs', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    // note: "june 1st, 0715" would parse "715" as year
    ['june 1st, 2020, 0715hrs', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 0315', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 0315hrs', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020, 0315hrs', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7:15', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 7 o\'clock', '2020-06-01T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 3:15', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['june 1st, 2020 at 3 o\'clock', '2020-06-01T03:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 0, second: 0, timezone: undefined } }],

    // numeric dates
    ['05/18/2020', '2020-05-18', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 18, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['5/18/2020', '2020-05-18', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 18, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['18/05/2020', '2020-05-18', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 18, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['18/5/2020', '2020-05-18', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 18, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['18.05.2020', '2020-05-18', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 18, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    // ambiguity is solved the American way
    ['05/12/2020', '2020-05-12', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 12, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    // but for dates in German format
    ['05.12.2020', '2020-12-05', 'DATE_0', { DATE_0: { year: 2020, month: 12, day: 5, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    // invalid dates and fractions
    ['05/32/2020', '5 / 32 / 2020', '5 / 32 / 2020', {}],
    ['05/18', '5 / 18', '5 / 18', {}],
    // this is also invalid but we won't notice
    ['04/31/2020', '2020-04-31', 'DATE_0', { DATE_0: { year: 2020, month: 4, day: 31, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    // valid
    ['2/29/2020', '2020-02-29', 'DATE_0', { DATE_0: { year: 2020, month: 2, day: 29, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    // invalid
    ['2/29/2019', '2019-02-29', 'DATE_0', { DATE_0: { year: 2019, month: 2, day: 29, hour: 0, minute: 0, second: 0, timezone: undefined } }],

    // numeric dates and times
    ['6/1 at 7:15am', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 7:15 in the morning', 'XXXX-06-01T07:15:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 7am', 'XXXX-06-01T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['6/1 at 7 o\'clock', 'XXXX-06-01T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['6/1 at 7 o\'clock in the morning', 'XXXX-06-01T07:00:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['6/1, 7:15am', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],

    ['6/1, 7:15pm', 'XXXX-06-01T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['6/1, 7:15 in the afternoon', 'XXXX-06-01T19:15:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 7:15pm', 'XXXX-06-01T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 7pm', 'XXXX-06-01T19:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['6/1 at 7 o\'clock in the afternoon', 'XXXX-06-01T19:00:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['6/1, 7:15pm', 'XXXX-06-01T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],

    ['6/1 at 0715', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 0715hrs', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1, 0715hrs', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 0315', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 0315hrs', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['6/1, 0315hrs', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 7:15', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 7 o\'clock', 'XXXX-06-01T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['6/1 at 3:15', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['6/1 at 3 o\'clock', 'XXXX-06-01T03:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 0, second: 0, timezone: undefined } }],

    // again, with years
    ['6/1/2020 at 7:15am', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7:15 in the morning', '2020-06-01T07:15:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7am', '2020-06-01T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7 o\'clock', '2020-06-01T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7 o\'clock in the morning', '2020-06-01T07:00:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['6/1/2020, 7:15am', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],

    ['6/1/2020, 7:15pm', '2020-06-01T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020, 7:15 in the afternoon', '2020-06-01T19:15:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7:15pm', '2020-06-01T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7pm', '2020-06-01T19:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7 o\'clock in the afternoon', '2020-06-01T19:00:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['6/1/2020, 7:15pm', '2020-06-01T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 19, minute: 15, second: 0, timezone: undefined } }],

    ['6/1/2020 at 0715', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 0715hrs', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    // note: "june 1st, 0715" would parse "715" as year
    ['6/1/2020, 0715hrs', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 0315', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 0315hrs', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020, 0315hrs', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7:15', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 7 o\'clock', '2020-06-01T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['6/1/2020 at 3:15', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['6/1/2020 at 3 o\'clock', '2020-06-01T03:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 0, second: 0, timezone: undefined } }],

    // now british style
    ['13/6 at 7:15am', 'XXXX-06-13T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 7:15 in the morning', 'XXXX-06-13T07:15:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 7am', 'XXXX-06-13T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['13/6 at 7 o\'clock', 'XXXX-06-13T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['13/6 at 7 o\'clock in the morning', 'XXXX-06-13T07:00:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['13/6, 7:15am', 'XXXX-06-13T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],

    ['13/6, 7:15pm', 'XXXX-06-13T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['13/6, 7:15 in the afternoon', 'XXXX-06-13T19:15:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: -1, month: 6, day: 13, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 7:15pm', 'XXXX-06-13T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 7pm', 'XXXX-06-13T19:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['13/6 at 7 o\'clock in the afternoon', 'XXXX-06-13T19:00:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: -1, month: 6, day: 13, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['13/6, 7:15pm', 'XXXX-06-13T19:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 19, minute: 15, second: 0, timezone: undefined } }],

    ['13/6 at 0715', 'XXXX-06-13T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 0715hrs', 'XXXX-06-13T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6, 0715hrs', 'XXXX-06-13T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 0315', 'XXXX-06-13T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 0315hrs', 'XXXX-06-13T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['13/6, 0315hrs', 'XXXX-06-13T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 7:15', 'XXXX-06-13T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 7 o\'clock', 'XXXX-06-13T07:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['13/6 at 3:15', 'XXXX-06-13T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['13/6 at 3 o\'clock', 'XXXX-06-13T03:00:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 13, hour: 3, minute: 0, second: 0, timezone: undefined } }],

    // again, with years
    ['13/6/2020 at 7:15am', '2020-06-13T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7:15 in the morning', '2020-06-13T07:15:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7am', '2020-06-13T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7 o\'clock', '2020-06-13T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7 o\'clock in the morning', '2020-06-13T07:00:00 in the morning', 'DATE_0 in the morning', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['13/6/2020, 7:15am', '2020-06-13T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],

    ['13/6/2020, 7:15pm', '2020-06-13T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020, 7:15 in the afternoon', '2020-06-13T19:15:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: 2020, month: 6, day: 13, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7:15pm', '2020-06-13T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 19, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7pm', '2020-06-13T19:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7 o\'clock in the afternoon', '2020-06-13T19:00:00 in the afternoon', 'DATE_0 in the afternoon', { DATE_0: { year: 2020, month: 6, day: 13, hour: 19, minute: 0, second: 0, timezone: undefined } }],
    ['13/6/2020, 7:15pm', '2020-06-13T19:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 19, minute: 15, second: 0, timezone: undefined } }],

    ['13/6/2020 at 0715', '2020-06-13T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 0715hrs', '2020-06-13T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    // note: "june 1st, 0715" would parse "715" as year
    ['13/6/2020, 0715hrs', '2020-06-13T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 0315', '2020-06-13T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 0315hrs', '2020-06-13T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020, 0315hrs', '2020-06-13T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7:15', '2020-06-13T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 7 o\'clock', '2020-06-13T07:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 7, minute: 0, second: 0, timezone: undefined } }],
    ['13/6/2020 at 3:15', '2020-06-13T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 3, minute: 15, second: 0, timezone: undefined } }],
    ['13/6/2020 at 3 o\'clock', '2020-06-13T03:00:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 13, hour: 3, minute: 0, second: 0, timezone: undefined } }],

    // misc tests from almond-tokenizer
    ['show me the 3rd result', 'show me the 3rd result', 'show me the 3rd result', {}],
    // note: almond-tokenizer processes this as "show me 5 star restaurants" without the dash
    ['show me 5-star restaurants', 'show me 5 -star restaurants', 'show me 5 -star restaurants', {}],
    ['Show me a picture of restaurants with more than two reviews.',
     'show me a picture of restaurants with more than 2 reviews .',
     'show me a picture of restaurants with more than 2 reviews .', {}],
    ['Show me a picture of restaurants with more than 1,000 reviews.',
     'show me a picture of restaurants with more than 1000 reviews .',
     'show me a picture of restaurants with more than 1000 reviews .',
     {}],
    ['Show me a picture of restaurants with more than a thousand reviews.',
     'show me a picture of restaurants with more than 1000 reviews .',
     'show me a picture of restaurants with more than 1000 reviews .',
     {}],
    ['Show me a picture of restaurants with more than one thousand reviews.',
     'show me a picture of restaurants with more than 1000 reviews .',
     'show me a picture of restaurants with more than 1000 reviews .',
     {}],
    ['give me the telephone of the restaurant with “94305” as postal code closest to work.',
     'give me the telephone of the restaurant with “94305” as postal code closest to work .',
     'give me the telephone of the restaurant with QUOTED_STRING_0 as postal code closest to work .',
     { QUOTED_STRING_0: '94305' }],
    ['fetch review having later date published than Feb 14 2017',
     'fetch review having later date published than 2017-02-14',
     'fetch review having later date published than DATE_0',
     { DATE_0: { year: 2017, month: 2, day: 14, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['which are reviews having later date published than May 4th, 2016 for restaurant having bigger than 2 reviews',
     'which are reviews having later date published than 2016-05-04 for restaurant having bigger than 2 reviews',
     'which are reviews having later date published than DATE_0 for restaurant having bigger than 2 reviews',
     { DATE_0: { year: 2016, month: 5, day: 4, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['What\'s the rating of the review dated sooner than May 4th, 2016?',
    'what \'s the rating of the review dated sooner than 2016-05-04 ?',
    'what \'s the rating of the review dated sooner than DATE_0 ?',
     { DATE_0: { year: 2016, month: 5, day: 4, hour: 0, minute: 0, second: 0, timezone: undefined } }],


    // weird stuff that we shouldn't tokenize but we sometime do
    ['str:QUOTED_STRING::0:',
     'str : quoted_string : : 0 :',
     'str : quoted_string : : 0 :', {}],

    // hyphens
    ['in-n-out', 'in-n-out', 'in-n-out', {}],
    ['state-of-the-art', 'state-of-the-art', 'state-of-the-art', {}],
    ['top-10', 'top- 10', 'top- 10', {}],
    ['top-10k', 'top- 10 k', 'top- 10 k', {}],

    // underscore
    ['user_name', 'user_name','user_name', {}],
    ['user_name_0', 'user_name_0','user_name_0', {}],
    ['_xx_88', '_xx_88','_xx_88', {}],
];

const DETOKENIZER_TEST_CASES = [
    // order is input, tokenized, detokenized

    ['post on twitter', 'post on twitter', 'post on twitter'],
    ['post    on      twitter', 'post on twitter', 'post on twitter'],
    ['post    on \n \t   twitter', 'post on twitter', 'post on twitter'],
    ['Post on Twitter.', 'post on twitter .', 'post on twitter.'],
    ['Post on Twitter???', 'post on twitter ? ? ?', 'post on twitter???'],
    ['Post 😗 on Twitter', 'post 😗 on twitter', 'post 😗 on twitter'],
    ['make a twitter-post', 'make a twitter-post', 'make a twitter-post'],
    ['make a twitter-', 'make a twitter -', 'make a twitter -'],

    // abbreviations
    ['so e.g. this is a sentence, ie. something you type',
     'so e.g. this is a sentence , ie. something you type',
     'so e.g. this is a sentence, ie. something you type'],
    ['Prof. Monica S. Lam, Ph.D',
     'prof. monica s. lam , ph.d',
     'prof. monica s. lam, ph.d'],
    ['dr. so and so , m.d.',
     'dr. so and so , m.d.',
     'dr. so and so, m.d.'],
    ['apple computers inc., microsoft corp., another company ltd.',
     'apple computers inc. , microsoft corp. , another company ltd.',
     'apple computers inc., microsoft corp., another company ltd.'],
];

function main() {
    const langPack = I18n.get('en-US');
    const tokenizer = langPack.getTokenizer();

    let anyFailed = false;
    for (let [input, raw, processed, entities] of TEST_CASES) {
        const tokenized = tokenizer.tokenize(input);
        try {
            assert.strictEqual(tokenized.rawTokens.join(' '), raw);
            assert.strictEqual(tokenized.tokens.join(' '), processed);
            assert.deepStrictEqual(tokenized.entities, entities);
        } catch(e) {
            console.error(`Test case "${input}" failed`); //"
            console.error(e);
            anyFailed = true;
        }
    }

    for (let [input, processed, expected] of DETOKENIZER_TEST_CASES) {
        const tokenized = tokenizer.tokenize(input);
        try {
            assert.strictEqual(tokenized.tokens.join(' '), processed);
            assert.deepStrictEqual(langPack.detokenizeSentence(tokenized.tokens), expected);
        } catch(e) {
            console.error(`Test case "${input}" failed`); //"
            console.error(e);
            anyFailed = true;
        }
    }
    if (anyFailed)
        throw new Error('Some test failed');
}
export default main;
if (!module.parent)
    main();
