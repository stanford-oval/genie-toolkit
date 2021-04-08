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
import { WS, makeToken } from './helpers';

// This tokenizer is inspired by the PTBTokenizer in CoreNLP, and it is somewhat
// compatible with it.
//
// Important differences:
// - parenthesis, dashes and quotes are not transformed
// - hyphens are never split (no clever heuristics)
// - fractions are not recognized, and / are always split unless recognized as a filename
// - assimilations (cannot, don't) are not split
// - measurements without space ("5gb") are split (unless recognized as a time or postcode)
// - legacy processing needed for old datasets is not applied
// - no Americanization (colour -> color, € -> $)
// - whitespace is defined as per Unicode standard
// - handling of quoted strings, filenames, URLs, phone numbers and emails according to our rules
// - casing of quoted strings, filenames, URLs etc. is preserved
//
// NO CODE WAS COPIED FROM CORENLP

const NUMBERS = {
    zero: 0,
    zeroth: 0,
    zeroeth: 0,
    a: 1, // as in "a hundred"
    one: 1,
    first: 1,
    two: 2,
    second: 2,
    three: 3,
    third: 3,
    four: 4,
    // fourth not forth, despite the famous joke:
    // And The Lord said unto John, "Come forth and receive eternal life"
    // but John came fifth and won a toaster.
    fourth: 4,
    five: 5,
    fifth: 5,
    six: 6,
    sixth: 6,
    seven: 7,
    seventh: 7,
    eight: 8,
    eighth: 8,
    nine: 9,
    ninth: 9,
    ten: 10,
    tenth: 10,
    eleven: 11,
    eleventh: 11,
    twelve: 12,
    twelfth: 13,
    thirteen: 13,
    thirteenth: 13,
    fourteen: 14,
    fourteeenth: 14,
    fifteen: 15,
    fifteenth: 15,
    sixteen: 16,
    sixteenth: 16,
    seventeen: 17,
    seventeenth: 17,
    eighteen: 18,
    eighteenth: 18,
    nineteen: 19,
    nineteenth: 19,
    twenty: 20,
    twentieth: 20,
    thirty: 30,
    thirtieth: 30,
    forty: 40,
    fourty: 40, // "fourty" is a typo, but a common one
    fortieth: 40,
    fifty: 50,
    fiftieth: 50,
    sixty: 60,
    sixtieth: 60,
    seventy: 70,
    seventieth: 70,
    eighty: 80,
    eightieth: 80,
    ninety: 90,
    ninetieth: 90
};

// NOTE: this uses the American convention for interpreting billions
const MULTIPLIERS = {
    hundred: 100,
    hundreds: 100,
    hundredth: 100,
    thousand: 1000,
    thousands: 1000,
    thousandth: 1000,
    million: 1e6,
    millions: 1e6,
    millionth: 1e6,
    billion: 1e9,
    billions: 1e9,
    billionth: 1e9,
    trillion: 1e12,
    trillions: 1e12,
    trillionth: 1e12,
    quadrillion: 1e15,
    quadrillions: 1e15,
    quadrillionth: 1e15,
};


const MONTHS = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
};

const CURRENCIES = {
    'dollars': 'usd',
    'dollar': 'usd',
    'bucks': 'usd',
    'buck': 'usd',
    'cents': '0.01usd',
    'pounds': 'gbp',
    'pound': 'gbp',
    'pence': '0.01gbp',
    'penny': '0.01gbp',
    'yen': 'jpy',
    'euros': 'eur',
    'euro': 'eur',
    'won': 'krw',
    'yuan': 'cny',

    '$': 'usd',
    'C$': 'cad',
    'A$': 'aud',
    '£': 'gbp',
    '€': 'eur',
    '₩': 'krw',
    // this is ambiguous, could be jpy or cny
    '¥': 'jpy',
};

export default class EnglishTokenizer extends BaseTokenizer {
    _initAbbrv() {
        // words with apostrophes
        this._addDefinition('APWORD', /(?:[a-z]+?n['’]t(?!{LETTER}))|o['’]clock(?!{LETTER})|o['’](?={WS}clock(?!{LETTER}))|['’]{LETTER}+/);

        // note: this is not meant to be a comprehensive list
        // if some abbreviation is added here, the period will become part of the abbreviation token
        // if not, the period will become a token of its own
        // there is really no hard rule of what should or should not be listed here
        // but:
        // - if it was in CoreNLP it probably should be here (for compat with existing string sets)
        // - if the period is in the middle of a token (e.g. "e.g."), then it should be here

        // pro of adding more abbrevations:
        // - token-level handling (augmentation etc.) will be more accurate
        // - we'll have fewer tokens with one/two letters
        // - truecasing will not accidentally capitalize the word after the abbreviation

        // con of adding more abbreviations:
        // - it might not match the pretraining of BERT models (but it won't affect RoBERTa because it uses SentencePiece)
        // - it will require more variants in the string sets
        // - it will never be complete

        // common abbreviations
        this._addDefinition('ABBRV_STATE', /(?:ala|ariz|ark|calif|colo|conn|dak|del|fla|ill|kans?|mass|mich|minn|miss|mont|nev|okla|ore|penn|tenn|tex|wash|wisc?|wyo)\./);
        this._addDefinition('ABBRV_COMPANY', /(?:inc|corp|ltd|univ|intl)\./);
        this._addDefinition('ABBRV_TITLE', /ph\.d|ed\.d|esq\.|jr\.|sr\.|prof\.|dr\.|mr\.|ms\.|mrs\./);
        this._addDefinition('ABBRV_LOCATION', /(?:st|ave|blvd|cyn|dr|ln|rd|apt|dept|tel|post)\./);


        // (single letter followed by ".") potentially repeated
        // this covers acronyms spelled with ".", and covers people's initials
        // there is no ambiguity because the only single letter words in English are "a" and "i" and they cannot be at the end of a sentence
        //
        // (colloquial ambiguity could arise from "u" to mean "you", as "i love u." - we'll live with that)
        this._addDefinition('INITIALISM', /(?:{LETTER}\.)+/);

        // list from CoreNLP and from https://abbreviations.yourdictionary.com/articles/list-of-commonly-used-abbreviations.html

        // "etc.", "incl.", "eg.", "wrt.", "ie.", "vs.", "misc.", "dept.", "appt.", "approx.", "est."
        // note that "e.g." and "i.e." are covered by the initialism rule above
        this._addDefinition('ABBRV_OTH', /(?:etc|incl|eg|wrt|ie|vs|misc|dept|appt|approx|est)\./);
        this._addDefinition('ABBRV_SPECIAL', /c\/o(?!{LETTER})/);

        this._lexer.addRule(/{ABBRV_STATE}|{ABBRV_COMPANY}|{ABBRV_TITLE}|{ABBRV_LOCATION}|{ABBRV_OTH}|{ABBRV_SPECIAL}|{INITIALISM}/,
            (lexer) => makeToken(lexer.index, lexer.text, lexer.text.toLowerCase().replace(/’/g, "'")));
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
        const parts = text.toLowerCase().split(/[ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff-]+(?:and[ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]+)*/g);
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

    _initSpecialNumbers() {
        this._lexer.addRule(/911/, (lexer) => makeToken(lexer.index, lexer.text));
    }

    _initNumbers() {
        // numbers in digit
        this._addDefinition('DIGITS', /[0-9]+(,[0-9]+)*/);
        this._addDefinition('DECIMAL_NUMBER', /\.{DIGITS}|{DIGITS}(?:\.{DIGITS})?/);

        this._lexer.addRule(/[+-]?{DECIMAL_NUMBER}/, (lexer) => {
            const value = this._parseDecimalNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, String(value));
        });

        // currencies
        this._lexer.addRule(/{DECIMAL_NUMBER}{WS}(dollars?|bucks?|cents?|pounds?|pence|penny|yen|euros?|won|yuan|usd|cad|aud|chf|eur|gbp|cny|jpy|krw)/, (lexer) => {
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
        this._addDefinition('ONE_DIGIT_NUMBER', /two|three|four|five|six|seven|eighth|nine/);

        // 2 to 12
        this._addDefinition('SMALL_NUMBER', /{ONE_DIGIT_NUMBER}|ten|eleven|twelve/);
        this._lexer.addRule(/{SMALL_NUMBER}/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, String(value));
        });

        // 13 to 19, or (20 to 90) optionally followed by ((- or whitespace) followed by 1 to 10)
        this._addDefinition('MEDIUM_NUMBER', /thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:(?:twenty|thirty|fou?rty|fifty|sixty|seventy|eighty|ninety)(?:(?:-|{WS})+(?:one|{ONE_DIGIT_NUMBER}))?)/);

        this._addDefinition('NUMBER_SEP', /{WS}|{WS}and{WS}/);

        // 1 to 99, as used by large and huge numbers
        this._addDefinition('LARGE_NUMBER_TRAIL', /{NUMBER_SEP}(one|{MEDIUM_NUMBER}|{SMALL_NUMBER}|{DECIMAL_NUMBER})/);

        // 100 to 999
        this._addDefinition('LARGE_NUMBER', /(?:a|one|{MEDIUM_NUMBER}|{SMALL_NUMBER}|{DECIMAL_NUMBER}){WS}hundreds?{LARGE_NUMBER_TRAIL}?/);

        // 1000 and above
        this._addDefinition('HUGE_NUMBER_CHUNK', /(a|one|{LARGE_NUMBER}|{MEDIUM_NUMBER}|{SMALL_NUMBER}|{DECIMAL_NUMBER}){WS}(?:thousands?|(?:m|b|tr|quadr)illions?)/);
        // note: this allows both "one million three hundred thousands" and "three hundred thousands one million" and "three thousands five thousands"
        // the latter two are invalid, but it gets way too messy otherwise
        this._addDefinition('HUGE_NUMBER', /{HUGE_NUMBER_CHUNK}(?:{NUMBER_SEP}{HUGE_NUMBER_CHUNK})*(?:{NUMBER_SEP}{LARGE_NUMBER}|{LARGE_NUMBER_TRAIL})?/);

        // medium, large and huge numbers are normalized
        this._lexer.addRule(/{HUGE_NUMBER}|{LARGE_NUMBER}|{MEDIUM_NUMBER}/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, String(value));
        });
    }

    _normalizeOrdinal(value) {
        let normalized;
        if (value % 10 === 1 && value % 100 !== 11)
            normalized = String(value) + 'st';
        else if (value % 10 === 2 && value % 100 !== 12)
            normalized = String(value) + 'nd';
        else if (value % 10 === 3 && value % 100 !== 13)
            normalized = String(value) + 'rd';
        else
            normalized = String(value) + 'th';
        return normalized;
    }

    _initOrdinals() {
        // ordinals in digit (1st, 2nd, 3rd, "4 th", 0-th, etc.
        this._lexer.addRule(/[0-9]*?(?:1[123]{WS}?-?th|1{WS}?-?st|2{WS}?-?nd|3{WS}?-?rd|[4-90]{WS}?-?th)(?!{LETTER})/, (lexer) => {
            const text = lexer.text.replace(/[^0-9]/g, '');
            const value = parseInt(text);
            const normalized = this._normalizeOrdinal(value);
            return makeToken(lexer.index, lexer.text, normalized);
        });

        // ordinals in words

        // - "zeroth" is not an ordinal (cannot be compounded with other number words)
        // - small numbers (1st to 12th) are untouched
        // - other numbers are converted to NUMBER tokens

        // 1st to 9th
        this._addDefinition('ONE_DIGIT_ORDINAL', /first|second|third|fourth|fifth|sixth|seventh|eighth|ninth/);
        this._addDefinition('SMALL_ORDINAL', /{ONE_DIGIT_ORDINAL}|eleventh|twelfth/);

        // 13th to 19th, or 20th, 30th, 40th, 50th, 60th, 70th, 80th, 90th, or  (20 to 90) followed by (- or whitespace) followed by 1 to 10
        this._addDefinition('MEDIUM_ORDINAL', /thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirthieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|(?:(?:twenty|thirty|fou?rty|fifty|sixty|seventy|eighty|ninety)(?:-|{WS})+(?:{ONE_DIGIT_ORDINAL}))/);

        // ending in 00th but not 000th: 100th, 200th, 300th, ... 1100th, 1200th, ...
        this._addDefinition('HUNDRED_LARGE_ORDINAL', /(?:{HUGE_NUMBER_CHUNK}{NUMBER_SEP})*(?:(?:{SMALL_NUMBER}|{MEDIUM_NUMBER}){WS})?hundredth/);

        // ending in 000th: 1000th, 2000th, 22000th, 300000th, 1000000th, 1500000th, ...
        // (this allows both "one million three hundred thousandth" and "three thousand two thousandth"
        // the latter is invalid, but it gets way too messy otherwise)
        this._addDefinition('THOUSAND_LARGE_ORDINAL', /(?:(?:{HUGE_NUMBER}|{LARGE_NUMBER}|{SMALL_NUMBER}|{MEDIUM_NUMBER}){WS})?(?:thousandth|(?:m|b|tr|quadr)illionth)/);

        // 101th and above, excluding those ending in 00th
        this._addDefinition('OTHER_LARGE_ORDINAL', /(?:{HUGE_NUMBER}|{LARGE_NUMBER}){NUMBER_SEP}(?:{SMALL_ORDINAL}|{MEDIUM_ORDINAL})/);

        // medium and large ordinals are normalized
        this._lexer.addRule(/{HUNDRED_LARGE_ORDINAL}|{THOUSAND_LARGE_ORDINAL}|{OTHER_LARGE_ORDINAL}|{MEDIUM_ORDINAL}/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            const normalized = this._normalizeOrdinal(value);
            return makeToken(lexer.index, lexer.text, normalized);
        });
    }

    _parseMilitaryTime(text) {
        text = text.replace(/[^0-9]/g, '');
        const hour = parseInt(text.substring(0, 2));
        const minute = parseInt(text.substring(2, 4));
        const second = parseInt(text.substring(4, 6)) || 0;
        return { hour, minute, second };
    }

    _initTimes() {
        // "we'll attack at 0700hrs"
        this._addDefinition('MILITARY_TIME', /(?:[01][0-9]|2[0-4]):?[0-6][0-9](?::?[0-6][0-9])?(hrs?)?/);
        // 12 hour clock (no subsecond allowed)
        this._addDefinition('HALF_PLAIN_TIME', /(?:1[012]|0?[0-9]):[0-6][0-9](?::[0-6][0-9])?/);

        this._lexer.addRule(/{MILITARY_TIME}/, (lexer) => {
            const parsed = this._parseMilitaryTime(lexer.text);
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });

        // morning markers
        this._addDefinition('TIME_12H_AM', /{HALF_PLAIN_TIME}(?:(?:{WS}?(?:am|a\.m\.))?(?={WS}in{WS}the{WS}morning(?!{LETTER}))|{WS}?(?:am(?!{LETTER})|a\.m\.))/);
        this._lexer.addRule(/{TIME_12H_AM}/, (lexer) => {
            const parsed = this._parse12HrTime(lexer.text, 'am');
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });
        this._addDefinition('TIME_OCLOCK_AM', /(?:1[012]|[0-9])(?:(?:{WS}?(?:am|a\.m\.))(?:{WS}o['’]{WS}?clock)?(?={WS}in{WS}the{WS}morning(?!{LETTER}))|{WS}?(?:am(?!{LETTER})|a\.m\.)(?:{WS}o['’]{WS}clock(?!{LETTER}))?)/);
        this._lexer.addRule(/{TIME_OCLOCK_AM}/, (lexer) => {
            const parsed = this._parseOClockTime(lexer.text, 'am');
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });

        // afternoon markers
        this._addDefinition('TIME_12H_PM', /{HALF_PLAIN_TIME}(?:(?:{WS}?(?:pm|p\.m\.))?(?={WS}in{WS}the{WS}(?:afternoon|evening))|{WS}?(?:pm(?!{LETTER})|p\.m\.))/);
        this._lexer.addRule(/{TIME_12H_PM}/, (lexer) => {
            const parsed = this._parse12HrTime(lexer.text, 'pm');
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });
        this._addDefinition('TIME_OCLOCK_PM_EXPLICIT', /(?:1[012]|[0-9])(?:(?:{WS}?(?:pm|p\.m\.))(?:{WS}o['’]{WS}?clock)?(?={WS}in{WS}the{WS}(?:afternoon|evening))|{WS}?(?:pm(?!{LETTER})|p\.m\.)(?:{WS}o['’]{WS}clock(?!{LETTER}))?)/);
        // only implicit marker ("7 o'clock in the afternoon")
        this._addDefinition('TIME_OCLOCK_PM_IMPLICIT', /(?:1[012]|[0-9])(?:{WS}o['’]{WS}?clock)(?={WS}in{WS}the{WS}(?:afternoon|evening))/);
        this._addDefinition('TIME_OCLOCK_PM', /{TIME_OCLOCK_PM_EXPLICIT}|{TIME_OCLOCK_PM_IMPLICIT}/);
        this._lexer.addRule(/{TIME_OCLOCK_PM}/, (lexer) => {
            const parsed = this._parseOClockTime(lexer.text, 'pm');
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });

        // no markers
        this._addDefinition('TIME_OCLOCK', /(?:1[0-9]|2[0-4]|[0-9])(?:{WS}o['’]{WS}?clock(?!{LETTER}))/);
        this._lexer.addRule(/{TIME_OCLOCK}/, (lexer) => {
            const parsed = this._parseOClockTime(lexer.text, '');
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });

        // chain up last so our rules take priority over the defaults
        super._initTimes();
    }

    _extractWordMonth(text) {
        const word = /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.exec(text.toLowerCase());
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
}
