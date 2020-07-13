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
"use strict";

const Lexer = require('flex-js');
const { WS, makeToken } = require('./helpers');

// This is the base class of all language-specific preprocessing. It is used if no
// language-specific code exists, and implements language-agnostic rules.
//
// See the English version in english.js for a much longer discussion

// disable eslint warning about combining characters
/*eslint no-misleading-character-class: off */

const TOUCH_TONES = {
    a: '2',
    b: '2',
    c: '2',
    d: '3',
    e: '3',
    f: '3',
    g: '4',
    h: '4',
    i: '4',
    j: '5',
    k: '5',
    l: '5',
    m: '6',
    n: '6',
    o: '6',
    p: '7',
    q: '7',
    r: '7',
    s: '7',
    t: '8',
    u: '8',
    v: '8',
    w: '9',
    x: '9',
    y: '9',
    z: '9',
};

module.exports = class BaseTokenizer {
    constructor() {
        this._lexer = new Lexer();

        this._lexer.setIgnoreCase(true);

        // IMPORTANT NOTE for reading this
        // this is a classic longest-match-first (greedy) lexical analyzer
        // hence, we don't need to delimit tokens, add trailing context or assertions
        // if some prefix of a word matches say a small number ("one" vs "oneiric", "three" vs "threesome", etc.)
        // but the word can continue, we'll continue scanning until the end of the word

        this._initBase();
        this._initAbbrv();
        this._initQuotedStrings();
        this._initFilenames();
        this._initURLs();
        this._initUsernameHashtags();
        this._initEmailAddress();
        // init zip codes and phone numbers before numbers so they take priority if they match the same string
        this._initPhoneNumber();
        this._initZipCodes();
        this._initNumbers();
        this._initOrdinals();
        this._initTimes();
        this._initDates();

        this._initCatchAll();
        //console.log(this._lexer.rules);
    }

    _addDefinition(name, expansion) {
        // HACK: the "addDefinition" function of Lexer does not recursively expand definitions, so we need to do that ourselves
        let source = expansion.source;
        for (let name in this._lexer.definitions) {
            const replace = new RegExp('{' + name + '}', 'ig');
            source = source.replace(replace, '(?:' + this._lexer.definitions[name] + ')');
        }
        this._lexer.addDefinition(name, new RegExp(source));
    }

    _initBase() {
        // whitespace
        // list from http://jkorpela.fi/chars/spaces.html
        this._addDefinition('WS', WS);

        // discard whitespace (default action is discard)
        this._lexer.addRule(WS);

        // non-BMP characters (mainly emojis)
        // note: these are not Unicode regular expressions, they are UTF-16 regular expressions
        this._addDefinition('NONBMP', /[\ud800-\ud8bff][\udc00-\udfff]/);
        // from https://unicode.org/Public/emoji/13.0/emoji-sequences.txt
        this._addDefinition('BMP_EMOJI1', /[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u261D\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26F9\u26FA\u26FD\u2705\u270A-\u270D\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]/);
        this._addDefinition('BMP_EMOJI2', /[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2194\u2195\u2196\u2197\u2198\u2199\u21A9\u21AA\u2328\u23CF\u23ED\u23EE\u23EF\u23F1\u23F2\u23F8\u23F9\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u2600\u2601\u2602\u2603\u2604\u260E\u2611\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638\u2639\u263A\u2640\u2642\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u2692\u2694\u2695\u2696\u2697\u2699\u269B\u269C\u26A0\u26A7\u26B0\u26B1\u26C8\u26CF\u26D1\u26D3\u26E9\u26F0\u26F1\u26F4\u26F7\u26F8\u26F9\u2702\u2708\u2709\u270C\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2763\u2764\u27A1\u2934\u2935\u2B05\u2B06\u2B07\u3030\u303D\u3297\u3299]\uFE0F/);
        // base character, followed by skin tone modifier, gender modifier, hair modifier
        // see https://eng.getwisdom.io/emoji-modifiers-and-sequence-combinations/ for a guide

        this._addDefinition('EMOJI1', /(?:{NONBMP}\uFE0F?|{BMP_EMOJI2}|{BMP_EMOJI1})(\ud83c[\udffb-\udfff])?[\u2640\u2642]?(\ud83e[\uddb0-\uddb3])?/);
        this._addDefinition('EMOJI2', /{EMOJI1}(\u200d{EMOJI1})*/);
        this._lexer.addRule(/{EMOJI2}/, (lexer) => makeToken(lexer.index, lexer.text));

        // letters (includes combining accents and letters commonly used in Western European languages)
        // taken from https://www.unicode.org/Public/UNIDATA/DerivedCoreProperties.txt (Alphabetic class, with some tweaks)
        //
        // XXX: we might want to extend this to all of Unicode Alphabetic characters, which includes all languages
        // and then exclude ideographic characters separately

        this._addDefinition('LETTER', /[a-z\u00C0-\u00D6\u00D8\u00F6\u00F8-\u01BA\u01BB\u01BC-\u01BF\u01C0-\u01C3\u01C4-\u0293\u0294\u0295\u02AF\u02EE\u0300-\u036f]/);

        // words
        // note that we do not split hyphens ever
        // hyphens are considered part of a word if at the beginning of a word or in-between two letters
        // (that is, at the end of a word, or when followed by another hyphen, they would become a token by itself)
        // numbers are considered part of a word if preceded by a letter
        this._addDefinition('WORD', /(-{LETTER})?(?:{LETTER}[0-9]*(-{LETTER})?)+/);
        // identifiers (tokens with at least an ASCI letter, but also - _ or a number)
        this._addDefinition('IDENT', /[a-z][a-z0-9_-]+|[0-9_-]+[a-z][a-z0-9_-]+/);
    }

    _initCatchAll() {
        // the simplest rule: matching words
        // this must be last so we match special words first (e.g. numbers and months)
        this._lexer.addRule(/{APWORD}|{WORD}/, (lexer) => makeToken(lexer.index, lexer.text));

        // old-school dashes
        this._lexer.addRule(/--/, (lexer) => makeToken(lexer.index, lexer.text));

        // collapse sequences of underscores
        this._lexer.addRule(/_+/, (lexer) => makeToken(lexer.index, lexer.text));

        // catch-all rule: punctuation and other symbols
        this._lexer.addRule(/./, (lexer) => makeToken(lexer.index, lexer.text));
    }

    _initQuotedStrings() {
        function makeQuotedString(lexer) {
            const content = lexer.text.substring(1, lexer.text.length-1);
            return makeToken(lexer.index, lexer.text, '“' + content + '”', 'QUOTED_STRING', content);
        }

        this._lexer.addRule(/"[^"]*"/, makeQuotedString);
        this._lexer.addRule(/“[^”]*”/, makeQuotedString);
        this._lexer.addRule(/‘[^’]*’/, makeQuotedString);
    }

    _initAbbrv() {
        // no special handling of abbreviations, initialisms or apostrophes by default
    }

    _initZipCodes() {
        // exactly 5 digits
        this._addDefinition('US_ZIP_CODE', /[0-9]{5}/);

        // 3 characters, at least one ASCII letter and one number
        this._addDefinition('UK_ZIP_CODE_PART', /[0-9][a-z][a-z0-9]|[a-z][0-9][a-z0-9]|[0-9]{2}[a-z]|[a-z]{2}[0-9]/);
        this._addDefinition('UK_ZIP_CODE', /{UK_ZIP_CODE_PART}{WS}?{UK_ZIP_CODE_PART}/);

        this._lexer.addRule(/{US_ZIP_CODE}|{UK_ZIP_CODE}/, (lexer) => makeToken(lexer.index, lexer.text));
    }

    _parseDecimalNumber(text) {
        // remove any ",", and remove any leading 0 or +
        let normalized = text.replace(/,/g, '').replace(/^[0+]+/g, '');
        return parseFloat(normalized);
    }

    _initNumbers() {
        // numbers in digit without any separator
        this._addDefinition('DIGITS', /[0-9]+/);
        this._addDefinition('DECIMAL_NUMBER', /\.{DIGITS}|{DIGITS}(?:\.{DIGITS})?/);

        this._lexer.addRule(/[+-]?{DECIMAL_NUMBER}/, (lexer) => {
            const value = this._parseDecimalNumber(lexer.text);
            if (Math.floor(value) === value && value <= 12 && value >= -12)
                return makeToken(lexer.index, lexer.text, String(value));
            else
                return makeToken(lexer.index, lexer.text, String(value), 'NUMBER', value);
        });
    }

    _initOrdinals() {
        // ordinals are not recognized by default
    }

    _initFilenames() {
        this._addDefinition('FILE_EXTENSION', /\.(?:txt|docx?|xlsx?|pptx?|odt|odp|ods|js|json|py|sql|css|html?|php|svg|pl|cpp|c|h|hpp|java|cs|sh|xml|csv|tsv|jpe?g|png|gif|svg|flv|swv|mov|wmv|mp4|mp3|aac|flac|bat|bmp|pdf|tex|rdf|tgz|tar(\.(gz|bz2|xz)?)|zip|rpm|deb|dll|exe)(?!{LETTER})/);

        // a file path is an optional drive letter ("c:\") followed by a filename (ident + known file extension),
        // or a slash/backslash separated identifiers followed by an ident with any extension
        this._lexer.addRule(/(?:[a-z]:\/])?(?:{IDENT}{FILE_EXTENSION}|{IDENT}([/\\]{IDENT})*[/\\]{IDENT}\.{IDENT})/,
            (lexer) => makeToken(lexer.index, lexer.text, lexer.text, 'PATH_NAME', lexer.text));
    }

    _initURLs() {
        // a long url is http:// and similar, followed by anything up to ">", "," or whitespace
        // (hence, parenthesis, quotes, etc. are part of the URL)
        this._lexer.addRule(/(?:https?|ftps?|ssh|sftp|file):\/\/[^ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff,>]+/,
            (lexer) => makeToken(lexer.index, lexer.text, lexer.text, 'URL', lexer.text));

        // a short url is www. followed by one or more . idents or words, or a one or more idents or words followed by a common TLD
        this._addDefinition('TLD', /(?:com|net|org|edu|mil|gov|arpa|biz|app|io|us|(ac|co)\.uk|eu|it|ca)(?!{LETTER})/);
        this._lexer.addRule(/(?:www\.{IDENT}(?:\.{IDENT})+|{IDENT}(\.{IDENT})*?\.{TLD})/,
            (lexer) => makeToken(lexer.index, lexer.text, 'http://' + lexer.text.toLowerCase(), 'URL', 'http://' + lexer.text.toLowerCase()));
    }

    _initUsernameHashtags() {
        this._lexer.addRule(/#(?:{WORD}|{IDENT})/,
            (lexer) => makeToken(lexer.index, lexer.text, undefined, 'HASHTAG', lexer.text.toLowerCase().substring(1)));
        this._lexer.addRule(/@(?:{WORD}|{IDENT})/,
            (lexer) => makeToken(lexer.index, lexer.text, undefined, 'USERNAME', lexer.text.toLowerCase().substring(1)));
    }

    _addIntlPrefix(text) {
        // by default, use the North American intl. prefix, but subclasses must override!
        if (text.startsWith('1'))
            text = '+' + text;
        else if (!text.startsWith('+'))
            text = '+1' + text;
        return text;
    }

    _initPhoneNumber() {
        this._addDefinition('INTL_PREFIX', /\+?1-?|\+[2-9][0-9]{1,2}-?/);
        this._addDefinition('AREA_CODE', /(?:\([0-9]{3,4}\)|[0-9]{3,4})-?/);
        this._addDefinition('STRICT_PHONE_NUMBER', /(?:[0-9][*#-]?){6,}/);
        this._addDefinition('LENIENT_PHONE_NUMBER', /[0-9*#-]{3,}{WS}?[a-z0-9*#-]{3,}/);
        this._addDefinition('TOUCH_TONE_PHONE_NUMBER', /[a-z0-9*#-]{5,}/);

        this._lexer.addRule(/{INTL_PREFIX}{WS}?{AREA_CODE}{WS}?{TOUCH_TONE_PHONE_NUMBER}|(?:{INTL_PREFIX}{WS}?)?{AREA_CODE}{WS}?{LENIENT_PHONE_NUMBER}|{STRICT_PHONE_NUMBER}/, (lexer) => {
            let normalized = this._addIntlPrefix(lexer.text);
            normalized = normalized.replace(/[() -]/g, '').replace(/[a-z]/g, (char) => TOUCH_TONES[char]);
            return makeToken(lexer.index, lexer.text, normalized, 'PHONE_NUMBER', normalized);
        });
    }

    _initEmailAddress() {
        this._lexer.addRule(/(?:mailto:)?(?:{LETTER}|[0-9.+_-])+@{IDENT}(\.{IDENT})+/, (lexer) => {
            let email = lexer.text.toLowerCase();
            if (email.startsWith('mailto:'))
                email = email.substring('mailto:'.length);
            return makeToken(lexer.index, lexer.text, email, 'EMAIL_ADDRESS', email);
        });
    }

    _normalizeTime(hour, minute, second, strictISO) {
        hour = String(hour);
        if (strictISO && hour.length === 1)
            hour = '0' + hour;
        minute = String(minute);
        if (minute.length === 1)
            minute = '0' + minute;
        second = String(second);
        if (second.length === 1)
            second = '0' + second;
        return hour + ':' + minute + ':' + second;
    }

    _parse12HrTime(text, ampm) {
        const parts = text.replace(/[^0-9:]/g, '').split(':');
        let hour = parseInt(parts[0]);
        if (ampm === 'am') {
            if (hour === 12)
                hour = 0;
        } else if (ampm === 'pm') {
            if (hour !== 12)
                hour += 12;
        } else if (ampm === '24h') {
            // no 12 hour adjustment, ever
        } else {
            // no marker, 24-hr clock
            if (hour === 24)
                hour = 0;
        }
        const minute = parseInt(parts[1]);
        const second = parseFloat(parts[2]) || 0;
        return { hour, minute, second };
    }

    _parseOClockTime(text, ampm) {
        let hour = parseInt(text.replace(/[^0-9]/g, ''));
        if (ampm === 'am') {
            if (hour === 12)
                hour = 0;
        } else if (ampm === 'pm') {
            if (hour !== 12)
                hour += 12;
        } else {
            // no marker, 24-hr clock
            if (hour === 24)
                hour = 0;
        }
        return { hour, minute: 0, second: 0 };
    }

    _parseMilitaryTime(text) {
        text = text.replace(/[^0-9]/g, '');
        const hour = parseInt(text.substring(0, 2));
        const minute = parseInt(text.substring(2, 4));
        const second = parseInt(text.substring(4, 6)) || 0;
        return { hour, minute, second };
    }

    _initTimes() {
        // "wake me up at 7:45"
        // 24 hour clock, with optional subsecond fractional part (mostly exists so we can fully roundtrip)
        // among other things this format should parse any ISO time string
        //
        // NOTE: some style guides advocate for "∶" (RATIO) in place of ":" (COLON)
        // and sadly NFKD doesn't get rid of it
        // but nobody in their right mind will casually type that so we pretend it doesn't exist
        this._addDefinition('PLAIN_TIME', /(?:1[0-9]|2[0-4]|[0-9]):[0-6][0-9](?::[0-6][0-9](\.[0-9]+)?)?/);

        // by default, only "ISO-style" times are recognized
        this._lexer.addRule(/{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parse12HrTime(lexer.text, '');
            return makeToken(lexer.index, lexer.text, this._normalizeTime(parsed.hour, parsed.minute, parsed.second), 'TIME', parsed);
        });
    }

    _normalizeDate(date) {
        let year = date.year;
        if (year === -1)
            year = 'XXXX';
        let month = String(date.month);
        if (month.length === 1)
            month = '0' + month;
        let day;
        if (date.day === -1)
            day = 'XX';
        else
            day = String(date.day);
        if (day.length === 1)
            day = '0' + day;
        if (date.hour !== 0 || date.minute !== 0 || date.second !== 0)
            return `${year}-${month}-${day}T${this._normalizeTime(date.hour, date.minute, date.second, true)}`;
        else
            return `${year}-${month}-${day}`;
    }

    _parseNumericDate(text, style, parseTime) {
        let year, month, day;
        let datestr, timestr;
        if (parseTime) {
            const idx = text.search(WS);
            datestr = text.substring(0, idx);
            timestr = text.substring(idx);
        } else {
            datestr = text;
        }

        if (style === 'mdy') {
            [month, day, year] = datestr.split(/[/.]/g);
            month = parseInt(month);
            day = parseInt(day);
            if (year)
                year = parseInt(year);
            else
                year = -1;
        } else if (style === 'dmy') {
            [day, month, year] = datestr.split(/[/.]/g);
            month = parseInt(month);
            day = parseInt(day);
            if (year)
                year = parseInt(year);
            else
                year = -1;
        } else {
            // ymd
            [year, month, day] = datestr.split(/[/.]/g);
            year = parseInt(year);
            month = parseInt(month);
            day = parseInt(day);
        }
        if (parseTime) {
            const time = parseTime(timestr);
            return { year, month, day, hour: time.hour, minute: time.minute, second: time.second, timezone: undefined };
        } else {
            return { year, month, day, hour: 0, minute: 0, second: 0, timezone: undefined };
        }
    }

    _initDates() {
        // by default, only full ISO dates are recognized

        // ISO dates (for roundtripping only)
        // year-month-day, XXXX-month-day or year-month-XX
        this._addDefinition('NUMERIC_DATE_ISO', /(?:[0-9]{4}|XXXX)-(?:1[012]|0[1-9])-(?:[12][0-9]|3[01]|0[1-9]|XX)(?![0-9X])/);
        this._lexer.addRule(/{NUMERIC_DATE_ISO}/, (lexer) => {
            let [year, month, day] = lexer.text.toUpperCase().split('-');
            if (year === 'XXXX')
                year = -1;
            if (day === 'XX')
                day = -1;
            return makeToken(lexer.index, lexer.text, lexer.text.toUpperCase(), 'DATE', { year, month, day, hour: 0, minute: 0, second: 0, timezone: undefined });
        });
        // with time (yyyy-MM-ddThh:mm:ss optionally followed by Z (timezone marker))
        this._lexer.addRule(/{NUMERIC_DATE_ISO}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z?/, (lexer) => {
            let timezone = lexer.text.indexOf('Z') >= 0 ? 'UTC' : undefined;
            let normalized = lexer.text.toUpperCase().replace('Z', '');
            let [datestr, timestr] = normalized.split('T');
            let [year, month, day] = datestr.toUpperCase().split('-');
            if (year === 'XXXX')
                year = -1;
            if (day === 'XX')
                day = -1;
            let [hour, minute, second] = timestr.split(':');
            hour = parseInt(hour);
            minute = parseInt(minute);
            second = parseFloat(second);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', { year, month, day, hour, minute, second, timezone });
        });
    }

    tokenize(text) {
        // apply compatibility normalizations of certain exotic Unicode characters, and split out
        // combining characters
        text = text.normalize('NFKD');
        this._lexer.setSource(text);

        let assignments = {};
        let entities = {};
        let rawTokens = [];
        let tokens = [];

        let token;
        while ((token = this._lexer.lex()) !== Lexer.EOF) {
            rawTokens.push(token.normalized);
            if (token.type) {
                let assigned = assignments[token.type];
                if (!assigned)
                    assigned = assignments[token.type] = new Map; // FIXME the map here should use deep equality rather than === (to handle Date, Time and Currency)
                let idx = assigned.get(token.value);
                if (idx === undefined) {
                    idx = assigned.size;
                    assigned.set(token.value, idx);
                }
                entities[token.type + '_' + idx] = token.value;
                tokens.push(token.type + '_' + idx);
            } else {
                tokens.push(token.normalized);
            }
        }

        return { tokens, rawTokens, entities };
    }
};
