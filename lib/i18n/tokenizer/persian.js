// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const BaseTokenizer = require('./base');
const { WS, makeToken } = require('./helpers');


const NUMBERS = {
    صفر: 0,
    پوچ: 0,
    یک: 1,
    یکم: 1,
    اول: 1,
    دو: 2,
    دوم: 2,
    سه: 3,
    سوم: 3,
    چهار: 4,
    چهارم: 4,
    پنج: 5,
    پنجم: 5,
    شش: 6,
    شیش: 6,
    شیشم: 6,
    هفت: 7,
    هفتم: 7,
    هشت: 8,
    هشتم: 8,
    نه: 9,
    نهم: 9,
    ده: 10,
    دهم: 10,
    یازده: 11,
    یازدهم: 11,
    دوازده: 12,
    دوازدهم: 13,
    سیزده: 13,
    سیزدهم: 13,
    چهارده: 14,
    چهاردهم: 14,
    پانزده: 15,
    پانزدهم: 15,
    شانزده: 16,
    شانزدهم: 16,
    هفده: 17,
    هیفده: 17,
    هفدهم: 17,
    هیفدهم: 17,
    هجده: 17,
    هجفده: 17,
    هجدهم: 17,
    هیجدهم: 17,
    نوزده: 19,
    نوزدهم: 19,
    بیست: 20,
    بیستم: 20,
    سی: 30,
    سیم: 30,
    چهل: 40,
    چهلم: 40,
    پنجاه: 50,
    پنجاهم: 50,
    شصت: 60,
    شصتم: 60,
    هفتاد: 70,
    هفتادم: 70,
    هشتاد: 80,
    هشتادم: 80,
    نود: 90,
    نودم: 90
};

const MULTIPLIERS = {
    صد: 100,
    صدم: 100,
    هزار: 1000,
    هزارم: 1000,
    میلیون: 1e6,
    میلیونم: 1e6,
    بیلیون: 1e9,
    بیلیونم: 1e9,
    میلیارد: 1e9,
    میلیاردم: 1e9,
    تریلیون: 1e12,
    تریلیونم: 1e12,
    کوآدریلیون: 1e15,
    کوآدریلیونم: 1e15,
};


const MONTHS = {
    فروردین: 1,
    اردیبهشت: 2,
    خرداد: 3,
    تیر: 4,
    مرداد: 5,
    شهریور: 6,
    مهر: 7,
    آبان: 8,
    آذر: 9,
    دی: 10,
    بهمن: 11,
    اسفند: 12
};

const CURRENCIES = {
    'دلار': 'usd',
    'سنت': '0.01usd',
    'پوند': 'gbp',
    'پنس': '0.01gbp',
    'پنی': '0.01gbp',
    'ین': 'jpy',
    'یورو': 'eur',
    'وون': 'krw',
    'یوان': 'cny',
    'ریال': 'irr',

    '$': 'usd',
    '£': 'gbp',
    '€': 'eur',
    '₩': 'krw',
    '¥': 'jpy',
};

module.exports = class EnglishTokenizer extends BaseTokenizer {
    _addIntlPrefix(text) {
        // assume PRC
        if (!text.startsWith('+'))
            text = '+98' + text;
        return text;
    }
    _parseWordNumber(text) {
        // note: this function will parse a bunch of things that are not valid, such a mixed ordinal and cardinal numbers
        // this is ok because we only call it with good stuff

        // the basic operation of this function is fairly simple:
        // - you have additive numbers (one to nine, and ten, twenty, etc. to ninety)
        // - you have multipliers (thousand, million, billion, and up)
        // - numbers in between multipliers are added
        // - multipliers take the current number, multiply it and add it to the total
        //
        // the special case is "hundred": it multiplies the current number and doesn't add to the total
        // because it can be followed by another multiplier


        // "value" is the total number, "current" is a single piece before a multiplier ("thousand", "billion", etc.)
        let value = 0;
        let current = 0;

        // examples:
        //
        // "three hundred millions" (3e11)
        // - "three" -> value = 0, current = 3
        // - "hundred" -> value = 0, current = 300
        // - "millions" -> value = 3e11, current = 0
        //
        // "three hundred twenty two thousands four hundred and five" (322405)
        // - "three" -> value = 0, current = 3
        // - "hundred" -> value = 0, current = 300
        // - "twenty" -> value = 0, current = 320
        // - "two" -> value = 0, current = 322
        // - "thousands" -> value = 322000, current = 0
        // - "four" -> value = 322000, current = 4
        // - "hundred" -> value = 322000, current = 400
        // - "five" -> value = 322000, current = 405
        // final value is 322405

        // split on "and", "-", and whitespace
        const parts = text.toLowerCase().split(/[ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff-]+(?:و[ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]+)*/g);
        for (const part of parts) {
            if (part in MULTIPLIERS) {
                const multiplier = MULTIPLIERS[part];
                if (current === 0)
                    current = 1;
                if (multiplier === 100) {
                    current *= 100;
                } else {
                    value += current * multiplier;
                    current = 0;
                }
            } else if (part in NUMBERS) {
                current += NUMBERS[part];
            } else {
                current += this._parseDecimalNumber(part);
            }
        }
        value += current;
        return value;
    }

    _parseDecimalNumber(text) {
        // remove any ",", and remove any leading 0 or +
        let normalized = text.replace(/,،/g, '').replace(/^[۰0+]+/g, '');
        return parseFloat(normalized);
    }

    _initNumbers() {
        // numbers in digit
        this._addDefinition('DIGITS', /[0-9۰-۹]+([,،][0-9۰-۹]+)*/);
        this._addDefinition('DECIMAL_NUMBER', /\.{DIGITS}|{DIGITS}(?:\.{DIGITS})?/);

        this._lexer.addRule(/[+-]?{DECIMAL_NUMBER}/, (lexer) => {
            const value = this._parseDecimalNumber(lexer.text);
            if (Math.floor(value) === value && value <= 12 && value >= -12)
                return makeToken(lexer.index, lexer.text, String(value));
            else
                return makeToken(lexer.index, lexer.text, String(value), 'NUMBER', value);
        });

        // currencies
        this._lexer.addRule(/{DECIMAL_NUMBER}{WS}(دلار|سنت|پوند|پنس|پنی|ین|وون|ریال|یوان|usd|کاد|chf|فرانک|یورو|gbp|cny|جیپی|krw)/, (lexer) => {
            let [num, unit] = lexer.text.split(WS);
            let value = this._parseDecimalNumber(num);
            if (unit in CURRENCIES)
                unit = CURRENCIES[unit];
            if (unit.startsWith('0.01')) {
                value *= 0.01;
                unit = unit.substring(4);
            }
            return makeToken(lexer.index, lexer.text, String(value) + ' ' + unit, 'CURRENCY', { value, unit });
        });
        this._lexer.addRule(/(?:C\$|A\$|[$£€₩¥]){WS}?{DECIMAL_NUMBER}/, (lexer) => {
            let unit = lexer.text.match(/C\$|A\$|[$£€₩¥]/)[0];
            unit = CURRENCIES[unit];
            let num = lexer.text.replace(/(?:C\$|A\$|[$£€₩¥])/g, '').replace(WS, '');
            let value = this._parseDecimalNumber(num);
            return makeToken(lexer.index, lexer.text, String(value) + ' ' + unit, 'CURRENCY', { value, unit });
        });

        // numbers in words

        // - "zero" is not a number (cannot be compounded with other number words)
        // - "one" is not normalized when alone
        // - small numbers (2 to 12) are normalized to digits
        // - other numbers are converted to NUMBER tokens

        // 2 to 9
        this._addDefinition('ONE_DIGIT_NUMBER', /دو|سه|چهار|پنج|شش|هفت|هشت|نه/);

        // 2 to 12
        this._addDefinition('SMALL_NUMBER', /{ONE_DIGIT_NUMBER}|ده|یازده|دوازده/);
        this._lexer.addRule(/{SMALL_NUMBER}/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, String(value));
        });

        // 13 to 19, or (20 to 90) optionally followed by ((- or whitespace) followed by 1 to 10)
        this._addDefinition('MEDIUM_NUMBER', /سیزده|چهارده|پانزده|شانزده|هفده|هجده|نوزده|(?:(?:بیست|سی|چهل|پنجاه|شصت|هفتاد|هشتاد|نود)(?:(?:-|{WS})+(?:یک|{ONE_DIGIT_NUMBER}))?)/);

        this._addDefinition('NUMBER_SEP', /{WS}|{WS}و{WS}/);

        // 1 to 99, as used by large and huge numbers
        this._addDefinition('LARGE_NUMBER_TRAIL', /{NUMBER_SEP}(یک|{SMALL_NUMBER}|{MEDIUM_NUMBER}|{DECIMAL_NUMBER})/);

        // 100 to 999
        this._addDefinition('LARGE_NUMBER', /(?:یک|{SMALL_NUMBER}|{MEDIUM_NUMBER}|{DECIMAL_NUMBER}){WS}صد?{LARGE_NUMBER_TRAIL}?/);

        // 1000 and above
        this._addDefinition('HUGE_NUMBER_CHUNK', /(یک|{SMALL_NUMBER}|{MEDIUM_NUMBER}|{LARGE_NUMBER}|{DECIMAL_NUMBER}){WS}(?:میلیارد|هزار|(?:م|ب|تر|کوآدر)یلیون?)/);
        // note: this allows both "one million three hundred thousands" and "three hundred thousands one million" and "three thousands five thousands"
        // the latter two are invalid, but it gets way too messy otherwise
        this._addDefinition('HUGE_NUMBER', /{HUGE_NUMBER_CHUNK}(?:{NUMBER_SEP}{HUGE_NUMBER_CHUNK})*(?:{NUMBER_SEP}{LARGE_NUMBER}|{LARGE_NUMBER_TRAIL})?/);

        // medium, large and huge numbers are normalized
        this._lexer.addRule(/{HUGE_NUMBER}|{LARGE_NUMBER}|{MEDIUM_NUMBER}/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, String(value), 'NUMBER', value);
        });
    }

    _initOrdinals() {
        // ordinals in digit (in persian we almost never use ordinals in digit and prefer the words format)

        // ordinals in words
        // - "zeroth" is not an ordinal (cannot be compounded with other number words)
        // - small numbers (first to twelfth) are untouched
        // - other numbers are converted to NUMBER tokens

        // 1st to 9th
        // this._addDefinition('ONE_DIGIT_ORDINAL', /اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم/);
        // this._addDefinition('SMALL_ORDINAL', /{ONE_DIGIT_ORDINAL}|یازدهم|دوازدهم/);
        //
        // // 13th to 19th, or 20th, 30th, 40th, 50th, 60th, 70th, 80th, 90th, or  (20 to 90) followed by (- or whitespace) followed by 1 to 10
        // this._addDefinition('MEDIUM_ORDINAL', /thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirthieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|(?:(?:twenty|thirty|fou?rty|fifty|sixty|seventy|eighty|ninety)(?:-|{WS})+(?:{ONE_DIGIT_ORDINAL}))/);
        //
        // // ending in 00th but not 000th: 100th, 200th, 300th, ... 1100th, 1200th, ...
        // this._addDefinition('HUNDRED_LARGE_ORDINAL', /(?:{HUGE_NUMBER_CHUNK}{NUMBER_SEP})*(?:(?:{SMALL_NUMBER}|{MEDIUM_NUMBER}){WS})?hundredth/);
        //
        // // ending in 000th: 1000th, 2000th, 22000th, 300000th, 1000000th, 1500000th, ...
        // // (this allows both "one million three hundred thousandth" and "three thousand two thousandth"
        // // the latter is invalid, but it gets way too messy otherwise)
        // this._addDefinition('THOUSAND_LARGE_ORDINAL', /(?:(?:{HUGE_NUMBER}|{LARGE_NUMBER}|{SMALL_NUMBER}|{MEDIUM_NUMBER}){WS})?(?:thousandth|(?:m|b|tr|quadr)illionth)/);
        //
        // // 101th and above, excluding those ending in 00th
        // this._addDefinition('OTHER_LARGE_ORDINAL', /(?:{HUGE_NUMBER}|{LARGE_NUMBER}){NUMBER_SEP}(?:{SMALL_ORDINAL}|{MEDIUM_ORDINAL})/);

        // medium and large ordinals are normalized
        this._lexer.addRule(/{MEDIUM_NUMBER}|{LARGE_NUMBER}|{HUGE_NUMBER})(?:م|ام|امین)?/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            const normalized = String(value);
            return makeToken(lexer.index, lexer.text, normalized, 'NUMBER', value);
        });
    }


    _initTimes() {
        // Time conventions from English can be adopted for Persian including "am" and "pm" markers except for o'clock rules
        // Colloquial forms of time are often used but there are too many variations and some are ambiguous
        // So we opt to let the neural network deal with it for now

        // 12 hour clock (no subsecond allowed)
        this._addDefinition('HALF_PLAIN_TIME', /(?:[۱1][۰۱۲012]|[۰-۹0-9]):[۰-۶0-6][۰-۹0-9](?::[۰-۶0-6][۰-۹0-9])?/);

        // morning markers
        this._addDefinition('TIME_12H_AM', /{HALF_PLAIN_TIME}(?:(?:{WS}?(?:am|a\.m\.))?(?={WS}صبح(?!{LETTER}))|{WS}?(?:am(?!{LETTER})|a\.m\.))/);
        this._lexer.addRule(/{TIME_12H_AM}/, (lexer) => {
            const parsed = this._parse12HrTime(lexer.text, 'am');
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });
        // afternoon markers
        this._addDefinition('TIME_12H_PM', /{HALF_PLAIN_TIME}(?:(?:{WS}?(?:pm|p\.m\.))?(?=[{WS}بعد{WS}از{WS}ظهر|عصر])|{WS}?(?:pm(?!{LETTER})|p\.m\.))/);
        this._lexer.addRule(/{TIME_12H_PM}/, (lexer) => {
            const parsed = this._parse12HrTime(lexer.text, 'pm');
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });

        // chain up last so our rules take priority over the defaults
        super._initTimes();

    }

    _extractWordMonth(text) {
        const word = /فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند/.exec(text.toLowerCase());
        return MONTHS[word[0]];
    }

    _parseWordDate(text, parseDay, parseYear, parseTime) {
        const month = this._extractWordMonth(text);
        const digitreg = /[0-9]+/g;
        let day = -1;
        if (parseDay) {
            // find the first sequence of digits to get the day
            day = parseInt(digitreg.exec(text)[0]);
        }
        let year = -1;
        if (parseYear) {
            // find the next sequence of digits to get the year
            // (digitreg is a global regex so it will start matching from the end of the previous match)
            year = parseInt(digitreg.exec(text)[0]);
        }
        if (parseTime) {
            // if we have a time, pick the remaining of the string and parse it
            const time = parseTime(text.substring(digitreg.lastIndex));
            return { year, month, day, hour: time.hour, minute: time.minute, second: time.second, timezone: undefined };
        } else {
            return { year, month, day, hour: 0, minute: 0, second: 0, timezone: undefined };
        }
    }

    _initDates() {
        // init ISO date recognition
        super._initDates();

        // note: CoreNLP recognizes days, months and years on their own, using a POS tagger
        // we opt to leave those alone
        // - this reduces ambiguity (around the word "may" for example - its tagging is quite imprecise with CoreNLP)
        // - avoids ambiguity with numbers and military time for years
        //
        // - days as number will be picked up as ordinals and turn into NUMBER
        // - days as names will be left as words (so you can use an enum for weekdays, as in MultiWOZ)
        // - months as number will be picked up as NUMBER (unlikely to appear in real usage)
        // - months as names will be left as words
        // - years will be picked up as NUMBER
        //
        // the neural network will pick up whatever it needs if those are actually day/month/years
        //
        // similarly, a day (in word, number or both) followed by a time will not be picked up as a DATE
        // it will be tokenized to a word or number, followed by TIME
        // (e.g. "tuesday at 3pm" will be "tuesday at TIME" but "tuesday may 3rd at 3pm" will be "DATE" with unspecified year)

        // note: we don't recognize ordinals in words as days
        // (i.e. "may first" will be parsed as "may first" instead of "DATE", and "may thirtieth" will be "may NUMBER")
        // i don't think anyone would type those explicitly, and speech-to-text should convert "may first" to "may 1st"
        // if STT doesn't do that, we'll revisit

        // the rules for commas are taken from https://www.thepunctuationguide.com/comma.html (British English)
        // and https://www.grammarly.com/blog/commas-in-dates/ (American English)
        // but commas are made optional everywhere
        // (that is, extra commas will prevent something from being recognized as a date, but lack of commas won't)

        this._addDefinition('ABBRV_DAY', /(?:mon|tues?|wed|thur?|fri|sat|sun)\./);
        this._addDefinition('LONG_DAY', /(?:mon|tues|wednes|thurs|fri|satur|sun)day/);

        // a number between 1 and 31, followed by optional appropriate ordinal suffix (with space or - if any)
        this._addDefinition('NUMERIC_DAY', /(?:[12](?:1(?:(?:{WS}-)?st)?|2(?:(?:{WS}-)?nd)?|3(?:(?:{WS}-)?rd)?|[04-9](?:(?:{WS}-)?th)?)|3(?:1(?:(?:{WS}-)?st)?|0(?:(?:{WS}-)?th)?)|(?:1(?:(?:{WS}-)?st)?|2(?:(?:{WS}-)?nd)?|3(?:(?:{WS}-)?rd)?|[4-9](?:(?:{WS}-)?th)?))(?![0-9])/);

        // note: there is no abbreviation for May
        this._addDefinition('ABBRV_MONTH', /(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?/);
        this._addDefinition('LONG_MONTH', /january|february|march|april|may|june|july|august|september|october|november|december/);

        // optional (day name followed by comma followed by whitespace), followed by month and day
        // "Tuesday, Jul. 7", "May 1st", "Apr. 30"
        this._addDefinition('MONTH_DAY', /(?:(?:{ABBRV_DAY}|{LONG_DAY}),?{WS})?(?:{LONG_MONTH}|{ABBRV_MONTH}){WS}{NUMERIC_DAY}(?!{LETTER})/);
        // optional (day name followed by comma followed by whitespace), followed by day, optional "of", month
        // "Tuesday, 7 Jul", "1st May", "30 Apr.", "2nd of August"
        this._addDefinition('DAY_MONTH', /(?:(?:{ABBRV_DAY}|{LONG_DAY}),?{WS})?{NUMERIC_DAY}{WS}(?:of{WS})?(?:{LONG_MONTH}|{ABBRV_MONTH})(?!{LETTER})/);

        // dates with words

        // day and month
        this._lexer.addRule(/{MONTH_DAY}|{DAY_MONTH}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, null);
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // day and month, followed by comma, followed by year
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?{WS}[0-9]{4}(?![0-9])/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, null);
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // month and year
        // XXX: CoreNLP/almond-tokenizer would parse this as today's date, in the given month
        // but maybe it should parse as the first day of the given month instead?
        this._lexer.addRule(/(?:{LONG_MONTH}|{ABBRV_MONTH}){WS}[0-9]{4}(?![0-9])/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, false, true, null);
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // day and month followed by comma, followed by optional "at", followed by a time
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?(?:{WS}at)?{WS}{MILITARY_TIME}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, this._parseMilitaryTime.bind(this));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?(?:{WS}at)?{WS}{TIME_12H_AM}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, (text) => this._parse12HrTime(text, 'am'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?(?:{WS}at)?{WS}{TIME_OCLOCK_AM}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, (text) => this._parseOClockTime(text, 'am'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?(?:{WS}at)?{WS}{TIME_12H_PM}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, (text) => this._parse12HrTime(text, 'pm'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?(?:{WS}at)?{WS}{TIME_OCLOCK_PM}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, (text) => this._parseOClockTime(text, 'pm'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?(?:{WS}at)?{WS}{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, (text) => this._parse12HrTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?(?:{WS}at)?{WS}{TIME_OCLOCK}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, (text) => this._parseOClockTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // day and month, followed by comma, followed by year, followed by optional "at", followed by a time
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?{WS}[0-9]{4}(?![0-9]),?(?:{WS}at)?{WS}{MILITARY_TIME}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, this._parseMilitaryTime.bind(this));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?{WS}[0-9]{4}(?![0-9]),?(?:{WS}at)?{WS}{TIME_12H_AM}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, (text) => this._parse12HrTime(text, 'am'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?{WS}[0-9]{4}(?![0-9]),?(?:{WS}at)?{WS}{TIME_OCLOCK_AM}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, (text) => this._parseOClockTime(text, 'am'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?{WS}[0-9]{4}(?![0-9]),?(?:{WS}at)?{WS}{TIME_12H_PM}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, (text) => this._parse12HrTime(text, 'pm'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?{WS}[0-9]{4}(?![0-9]),?(?:{WS}at)?{WS}{TIME_OCLOCK_PM}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, (text) => this._parseOClockTime(text, 'pm'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?{WS}[0-9]{4}(?![0-9]),?(?:{WS}at)?{WS}{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, (text) => this._parse12HrTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{MONTH_DAY}|{DAY_MONTH}),?{WS}[0-9]{4}(?![0-9]),?(?:{WS}at)?{WS}{TIME_OCLOCK}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, (text) => this._parseOClockTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // numeric dates

        // month/day/year
        this._addDefinition('NUMERIC_DATE_AMERICAN', /(?:1[012]|0?[1-9])\/(?:[12][0-9]|3[01]|0?[1-9])\/[0-9]{4}(?![0-9])/);
        // day/month/year
        this._addDefinition('NUMERIC_DATE_BRITISH', /(?:[12][0-9]|3[01]|0?[1-9])\/(?:1[012]|0?[1-9])\/[0-9]{4}(?![0-9])/);
        // day.month.year
        // month/day (only applicable with other signals that make it a date)
        this._addDefinition('NUMERIC_DATE_SHORT_AMERICAN', /(?:1[012]|0?[1-9])\/(?:[12][0-9]|3[01]|0?[1-9])/);
        this._addDefinition('NUMERIC_DATE_SHORT_BRITISH', /(?:[12][0-9]|3[01]|0?[1-9])\/(?:1[012]|0?[1-9])/);

        this._addDefinition('NUMERIC_DATE_GERMAN', /(?:[12][0-9]|3[01]|0[1-9])\.(?:1[012]|0[1-9])(?:\.[0-9]{4})?(?![0-9])/);

        // American before British, so in case ambiguity American wins
        this._lexer.addRule(/{NUMERIC_DATE_AMERICAN}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'mdy', null);
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/{NUMERIC_DATE_BRITISH}|{NUMERIC_DATE_GERMAN}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', null);
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // with time
        this._lexer.addRule(/(?:{NUMERIC_DATE_AMERICAN}|{NUMERIC_DATE_SHORT_AMERICAN}),?(?:{WS}at)?{WS}{MILITARY_TIME}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'mdy', this._parseMilitaryTime.bind(this));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_AMERICAN}|{NUMERIC_DATE_SHORT_AMERICAN}),?(?:{WS}at)?{WS}{TIME_12H_AM}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'mdy', (text) => this._parse12HrTime(text, 'am'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_AMERICAN}|{NUMERIC_DATE_SHORT_AMERICAN}),?(?:{WS}at)?{WS}{TIME_OCLOCK_AM}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'mdy', (text) => this._parseOClockTime(text, 'am'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_AMERICAN}|{NUMERIC_DATE_SHORT_AMERICAN}),?(?:{WS}at)?{WS}{TIME_12H_PM}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'mdy', (text) => this._parse12HrTime(text, 'pm'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_AMERICAN}|{NUMERIC_DATE_SHORT_AMERICAN}),?(?:{WS}at)?{WS}{TIME_OCLOCK_PM}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'mdy', (text) => this._parseOClockTime(text, 'pm'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_AMERICAN}|{NUMERIC_DATE_SHORT_AMERICAN}),?(?:{WS}at)?{WS}{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'mdy', (text) => this._parse12HrTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_AMERICAN}|{NUMERIC_DATE_SHORT_AMERICAN}),?(?:{WS}at)?{WS}{TIME_OCLOCK}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'mdy', (text) => this._parseOClockTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        this._lexer.addRule(/(?:{NUMERIC_DATE_BRITISH}|{NUMERIC_DATE_GERMAN}|{NUMERIC_DATE_SHORT_BRITISH}),?(?:{WS}at)?{WS}{MILITARY_TIME}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', this._parseMilitaryTime.bind(this));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_BRITISH}|{NUMERIC_DATE_GERMAN}|{NUMERIC_DATE_SHORT_BRITISH}),?(?:{WS}at)?{WS}{TIME_12H_AM}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', (text) => this._parse12HrTime(text, 'am'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_BRITISH}|{NUMERIC_DATE_GERMAN}|{NUMERIC_DATE_SHORT_BRITISH}),?(?:{WS}at)?{WS}{TIME_OCLOCK_AM}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', (text) => this._parseOClockTime(text, 'am'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_BRITISH}|{NUMERIC_DATE_GERMAN}|{NUMERIC_DATE_SHORT_BRITISH}),?(?:{WS}at)?{WS}{TIME_12H_PM}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', (text) => this._parse12HrTime(text, 'pm'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_BRITISH}|{NUMERIC_DATE_GERMAN}|{NUMERIC_DATE_SHORT_BRITISH}),?(?:{WS}at)?{WS}{TIME_OCLOCK_PM}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', (text) => this._parseOClockTime(text, 'pm'));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_BRITISH}|{NUMERIC_DATE_GERMAN}|{NUMERIC_DATE_SHORT_BRITISH}),?(?:{WS}at)?{WS}{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', (text) => this._parse12HrTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
        this._lexer.addRule(/(?:{NUMERIC_DATE_BRITISH}|{NUMERIC_DATE_GERMAN}|{NUMERIC_DATE_SHORT_BRITISH}),?(?:{WS}at)?{WS}{TIME_OCLOCK}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', (text) => this._parseOClockTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
    }
};
