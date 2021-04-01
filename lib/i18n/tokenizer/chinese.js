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


import BaseTokenizer from './base';
import { makeToken } from './helpers';

// 我觉得这比英语好太多了

const NUMBERS = {
    〇: 0,
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
};

const SMALL_MULTIPLIERS = {
    十: 10,
    百: 100,
    千: 1000,
};
const BIG_MULTIPLIERS = {
    万: 1e4,
    亿: 1e8,
    兆: 1e12
};

const CURRENCIES = {
    '美元': 'usd',
    '美金': 'usd',
    '刀': 'usd',
    '加元': 'cad',
    '澳元': 'aud',
    '英镑': 'gbp',
    '日圆': 'jpy',
    '日元': 'jpy',
    '欧元': 'eur',
    '欧': 'eur',
    '元': 'cny',
    '块': 'cny',

    '$': 'usd',
    '£': 'gbp',
    '€': 'eur',
    '₩': 'krw',
    '¥': 'cny',
};

export default class ChineseTokenizer extends BaseTokenizer {
    _addIntlPrefix(text) {
        // assume PRC
        if (!text.startsWith('+'))
            text = '+86' + text;
        return text;
    }

    _parseWordNumber(text) {
        // numbers in chinese have three levels
        // individual digits: 一 to 九
        // small multipliers: 十，白，千
        // big multipliers: 万，亿，兆

        // the logic is similar to other languages: you operate a buffer and multiply and add
        // there is one twist: the final multiplier might be omitted
        // to distinguish that case, we need to pay attention to the character "零"
        // if present, the multiplier is reset to 1 and the last digit will be a unit
        // if absent, the last digit is the previous multiplier divided by 10

        // "value" is the total number, "current_small" is the value before a small multiplier, "current_big" is the value before a big multiplier
        let value = 0;
        let current_small = 0;
        let current_big = 0;
        let lastMultiplier = 1;

        // example: 三十一万五千 (315000)
        // 三: value = 0, current_small = 3, current_big = 0
        // 十: value = 0, current_small = 0, current_big = 30
        // 一: value = 0, current_small = 1, current_big = 30
        // 万: value = 310000, current_small = 0, current_big = 0
        // 五: value = 310000, current_small = 5, current_big = 0
        // 千: value = 310000, current_small = 0, current_big = 5000
        // final value 315000

        // parse character by character
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '零') {
                // reset the multiplier
                lastMultiplier = 1;
            } else if (char in BIG_MULTIPLIERS) {
                const multiplier = BIG_MULTIPLIERS[char];
                current_big += current_small;
                if (current_big === 0)
                    current_big = 1;
                value += current_big * multiplier;
                current_big = 0;
                current_small = 0;
                lastMultiplier = multiplier/10;
            } else if (char in SMALL_MULTIPLIERS) {
                const multiplier = SMALL_MULTIPLIERS[char];
                if (current_small === 0)
                    current_small = 1;
                current_big += current_small * multiplier;
                current_small = 0;
                lastMultiplier = multiplier/10;
            } else if (char in NUMBERS) {
                current_small += NUMBERS[char];
            }
        }
        current_big += current_small * lastMultiplier;
        value += current_big;
        return value;
    }

    _initNumbers() {
        // numbers in digits

        // can be separated by space or comma
        this._addDefinition('DIGITS', /[0-9]+(?:(?:{WS}|,)[0-9]+)*/);
        this._addDefinition('DECIMAL_NUMBER', /\.{DIGITS}|{DIGITS}(?:\.{DIGITS})?/);

        this._lexer.addRule(/[+-]?{DECIMAL_NUMBER}/, (lexer) => {
            const value = this._parseDecimalNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, String(value));
        });

        // currencies
        this._lexer.addRule(/{DECIMAL_NUMBER}(?:[美加澳欧]?元|欧|英镑|日圆|日元|块|美金|刀)/, (lexer) => {
            let unitlength = /[美加澳欧]元|英镑|日[圆元]|美金/.test(lexer.text) ? 2 : 1;
            let num = lexer.text.substring(0, lexer.text.length-unitlength);
            let unit = CURRENCIES[lexer.text.substring(lexer.text.length-unitlength)];
            let value = this._parseDecimalNumber(num);
            return makeToken(lexer.index, lexer.text, String(value) + unit, 'CURRENCY', { value, unit });
        });
        this._lexer.addRule(/{DECIMAL_NUMBER}[a-z]{3}/, (lexer) => {
            let unitlength = 3;
            let num = lexer.text.substring(0, lexer.text.length-unitlength);
            let unit = lexer.text.substring(lexer.text.length-unitlength);
            let value = this._parseDecimalNumber(num);
            return makeToken(lexer.index, lexer.text, String(value) + unit, 'CURRENCY', { value, unit });
        });
        this._lexer.addRule(/(?:[$£€₩¥]){DECIMAL_NUMBER}/, (lexer) => {
            let unit = lexer.text.match(/[$£€₩¥]/)[0];
            unit = CURRENCIES[unit];
            let num = lexer.text.replace(/[$£€₩¥]/, '');
            let value = this._parseDecimalNumber(num);
            return makeToken(lexer.index, lexer.text, String(value) + unit, 'CURRENCY', { value, unit });
        });

        // numbers in words

        // - "零" (0) can appear pretty much anywhere in a compound number and has no effect (it is ignored on its own)
        // - "一" (1) is not touched when alone
        // - small numbers (2 to 12) are normalized to digits
        // - other numbers are converted to NUMBER tokens

        // note: trailing multipliers can be omitted, that is,
        // "二千二" means the same as "二千二百" (2200) rather than "二千零二" (2002)
        // while extracting, we ignore this, and allow "零" to be interspersed freely
        // we handle this case when converting the string to JS number

        // 2 to 9
        this._addDefinition('ONE_DIGIT_NUMBER', /[二三四五六七八九]/);

        // 2 to 12
        this._addDefinition('SMALL_NUMBER', /一?十[一二]|{ONE_DIGIT_NUMBER}/);
        this._lexer.addRule(/{SMALL_NUMBER}/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, String(value));
        });

        // 13 to 99
        this._addDefinition('MEDIUM_NUMBER', /[二三四五六七八九]十[一二三四五六七八九]?|一?十[三四五六七八九]/);

        // 1 to 99, as used by large and huge numbers
        this._addDefinition('LARGE_NUMBER_TRAIL', /{MEDIUM_NUMBER}|{SMALL_NUMBER}|一/);

        // 100 to 9999
        this._addDefinition('LARGE_NUMBER', /(?:[一二三四五六七八九]千零?([一二三四五六七八九]百零?)?|[一二三四五六七八九]?百零?){LARGE_NUMBER_TRAIL}?/);

        // 10000 and above
        this._addDefinition('HUGE_NUMBER', /(?:(?:{LARGE_NUMBER}|{MEDIUM_NUMBER}|{SMALL_NUMBER}|一)[万亿兆]零?)+(?:{LARGE_NUMBER}|{MEDIUM_NUMBER}|{SMALL_NUMBER}|一)?/);

        // medium, large and huge numbers are normalized
        this._lexer.addRule(/{HUGE_NUMBER}|{LARGE_NUMBER}|{MEDIUM_NUMBER}/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, String(value));
        });
    }

    _initOrdinals() {
        // ordinals are just 第 followed by a number in digit or a number in words
        // we don't need to do anything special for them
    }

    _findAndParseNumberOffset(letterRegex, numberRegex, string, _default) {
        let match = letterRegex.exec(string);
        if (match) {
            return this._parseWordNumber(match[1]);
        } else {
            match = numberRegex.exec(string);
            if (match)
                return parseInt(match[1]);
            else
                return _default;
        }
    }

    _parseColloquialTime(timestr) {
        let hour, minute, second;

        hour = this._findAndParseNumberOffset(/(一?十[一二]|[一二三四五六七八九])点/, /(1[0-2]|[1-9])点/, timestr, 0);
        second = this._findAndParseNumberOffset(/([一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])秒/, /([1-5][0-9]|0?[1-9])秒/, timestr, 0);

        if (timestr.indexOf('钟') >= 0) {
            minute = 0;
        } else if (timestr.indexOf('半') >= 0) {
            minute = 30;
        } else {
            let minutematch = /([一三])刻/.exec(timestr);
            if (minutematch)
                minute = 15 * this._parseWordNumber(minutematch[1]);
            else
                minute = this._findAndParseNumberOffset(/([一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])分/, /([1-5][0-9]|0?[1-9])分/, timestr, 0);
            if (timestr.indexOf('差') >= 0) {
                hour -= 1;
                hour %= 24;
                minute = 60 - minute;
            }
        }

        return { hour, minute, second };
    }

    _initTimes() {
        // chain up to load ISO time parsing
        super._initTimes();

        // times in words
        this._addDefinition('MINUTE_OR_SECOND', /[1-5][0-9]|0?[1-9]|[二三四五]?十[一二三四五六七八九]?|[一二三四五六七八九]/);
        this._addDefinition('NEGATIVE_TIME_OFFSET', /差(?:[一二]刻|{MINUTE_OR_SECOND}分)/);
        this._addDefinition('COLLOQUIAL_HOUR', /(?:一|{SMALL_NUMBER}|1[0-2]|0?[1-9])点/);

        this._addDefinition('COLLOQUIAL_TIME', /{NEGATIVE_TIME_OFFSET}{COLLOQUIAL_HOUR}|{COLLOQUIAL_HOUR}{NEGATIVE_TIME_OFFSET}|{COLLOQUIAL_HOUR}(?:[一三]刻|{MINUTE_OR_SECOND}分)(?:{MINUTE_OR_SECOND}秒)?|{COLLOQUIAL_HOUR}[半钟]?/);
        this._lexer.addRule(/{COLLOQUIAL_TIME}/, (lexer) => {
            const parsed = this._parseColloquialTime(lexer.text);
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });
    }

    _parseWordDate(text, parseTime) {
        const day = this._findAndParseNumberOffset(/(三十一?|[一二]十[一二三四五六七八九]?|[一二三四五六七八九])[号日]/, /(3[01]|[12][0-9]|[1-9])[号日]/, text, -1);
        const month = this._findAndParseNumberOffset(/(一?十[一二]|[一二三四五六七八九])月/, /(1[0-2]|[1-9])月/, text, -1);

        // the year is special, the digits are read in sequence without any multiplier
        let year = -1;
        const yearmatch = /([〇一二三四五六七八九0-9]{4})年/.exec(text);
        if (yearmatch)
            year = parseInt(yearmatch[1].replace(/[〇一二三四五六七八九]/g, (char) => NUMBERS[char]));

        if (parseTime) {
            // if we have a time, pick the remaining of the string and parse it
            let weekstr = /星期|周|礼拜/.exec(text);
            let dateend;
            if (weekstr) {
                // skip the week string and the day number after it
                dateend = weekstr.index + weekstr[0].length + 1;
            } else {
                let daystr = /[号日]/.exec(text);
                if (daystr)
                    dateend = daystr.index + 1;
                else
                    dateend = text.indexOf('月') + 1;
            }
            const time = parseTime(text.substring(dateend));
            return { year, month, day, hour: time.hour, minute: time.minute, second: time.second, timezone: undefined };
        } else {
            return { year, month, day, hour: 0, minute: 0, second: 0, timezone: undefined };
        }
    }

    _initDates() {
        // init ISO date recognition
        super._initDates();

        this._addDefinition('DAY_NAME', /(星期|周|礼拜)[一二三四五六日天]/);

        this._addDefinition('DAY', /(?:三十一?|[一二]十[一二三四五六七八九]?|[一二三四五六七八九]|3[01]|[12][0-9]|[1-9])[号日]/);
        this._addDefinition('MONTH', /(?:一?十[一二]|[一二三四五六七八九]|1[0-2]|[1-9])月/);
        this._addDefinition('YEAR', /[〇一二三四五六七八九0-9]{4}年/);

        // dates with words

        this._lexer.addRule(/(?:{YEAR}?{MONTH}{DAY}|{YEAR}{MONTH})(?:[,，]?{DAY_NAME})?/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, null);
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // date and time
        this._lexer.addRule(/(?:{YEAR}?{MONTH}{DAY}|{YEAR}{MONTH})(?:[,，]?{DAY_NAME})?在?{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, (text) => this._parse12HrTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // date and time (colloquial)
        this._lexer.addRule(/(?:{YEAR}?{MONTH}{DAY}|{YEAR}{MONTH})(?:[,，]?{DAY_NAME})?在?{COLLOQUIAL_TIME}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, (text) => this._parseColloquialTime(text));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
    }
}
