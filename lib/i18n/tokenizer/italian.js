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

const NUMBERS = {
    zero: 0,
    un: 1,
    uno: 1,
    due: 2,
    tre: 3,
    quattro: 4,
    cinque: 5,
    sei: 6,
    sette: 7,
    otto: 8,
    nove: 9,
    dieci: 10,
    undici: 11,
    dodici: 12,
    tredici: 13,
    quattordici: 14,
    quindici: 15,
    sedici: 16,
    diciassette: 17,
    diciotto: 18,
    diciannove: 19,

    // the form without the final vowel is used when followed by "uno" or "otto"
    vent: 20,
    venti: 20,
    trent: 30,
    trenta: 30,
    quarant: 40,
    quaranta: 40,
    cinquant: 50,
    cinquanta: 50,
    sessant: 60,
    sessanta: 60,
    settant: 70,
    settanta: 70,
    ottant: 80,
    ottanta: 80,
    novant: 90,
    novanta: 90,
};

const MULTIPLIERS = {
    cent: 100,
    cento: 100,
    mille: 1000,
    mila: 1000,
    milione: 1e6,
    milioni: 1e6,
    miliardo: 1e9,
    miliardi: 1e9,
    // AFAIK, nothing is commonly used above this
    // Wikipedia has definitions for "biliardo" and "triliardo"
    // but they are confusing and too big to be useful
    // also, people commonly say "duemila miliardi"
};

const MONTHS = {
    gen: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    mag: 5,
    giu: 6,
    lug: 7,
    ago: 8,
    'set': 9, // "set" is a JS keyword
    ott: 10,
    nov: 11,
    dic: 12
};

const CURRENCIES = {
    'dollaro': 'usd',
    'dollari': 'usd',
    'sterlina': 'gbp',
    'sterline': 'gbp',
    'pence': '0.01gbp',
    'penny': '0.01gbp',
    'yen': 'jpy',
    'euro': 'eur',
    'eurocent': '0.01eur',
    'cent': '0.01eur',
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

export default class ItalianTokenizer extends BaseTokenizer {
    _initAbbrv() {
        // always attach the apostrophe to the preceding word
        this._addDefinition('APWORD', /{LETTER}+'/);

        // common abbreviations
        // other abbreviations that TINT (CoreNLP for Italian) included were Geom., Avv., Mons. and many others
        // but I don't think they're very useful
        this._addDefinition('ABBRV_TITLE', /sig\.(?:r[aei])?|dott\.(?:ssa)?|prof\.(?:ssa)?/);

        // initialisms are as in english (same observations apply more or less)
        // note: in italian this also covers corporate abbreviations (S.p.A., S.r.l.)
        this._addDefinition('INITIALISM', /(?:{LETTER}\.)+/);

        this._lexer.addRule(/{ABBRV_TITLE}|{INITIALISM}/,
            (lexer) => makeToken(lexer.index, lexer.text));
    }

    _addIntlPrefix(text) {
        // assume Italian/Italy locale
        if (!text.startsWith('+'))
            text = '+39' + text;
        return text;
    }

    _parseWordNumber(text) {
        // the logic for this function is exactly the same as the English version, except
        // that in Italian there are no spaces before the suffixes "cento" (hundred) and "mila" (thousands)
        // so to parse a number in word we need to use another regular expression

        // "value" is the total number, "current" is a single piece before a multiplier ("thousand", "billion", etc.)
        let value = 0;
        let current = 0;

        // remove junk
        text = text.replace(/[ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff-]+(?:e[ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]+)*/g, '');

        // turn ordinals into cardinals
        text = text
            .replace(/prim[oaei]|unesim[oaie]/, 'uno')
            .replace(/second[oaei]|duesim[oaie]/, 'due')
            .replace(/terz[oaei]|treesim[oaie]/, 'tre')
            .replace(/quart[oaei]|treesim[oaie]/, 'quattro')
            .replace(/quint[oaei]|cinquesim[oaie]/, 'cinque')
            .replace(/sest[oaei]|seiesim[oaie]/, 'sei')
            .replace(/settim[oaei]|settesim[oaie]/, 'sette')
            .replace(/ottav[oaei]|ottesim[oaie]/, 'otto')
            .replace(/nono[oaei]|novesim[oaie]/, 'nove')
            .replace(/decim[oaei]/, 'dieci')
            // "undecimo" is an archaic form of "undicesimo"
            .replace(/undecim[oaei]|undicesim[oaie]/, 'undici')
            .replace(/duodecim[oaei]|dodicesim[oaei]/, 'dodici')
            // ending in "i"
            .replace(/(tredic|quattrodic|quindic|sedic|vent)esim[oaei]/, '$1i')
            // ending in "e"
            .replace(/(diciassett|diciannov|mill|milion)esim[oaei]/, '$1e')
            // ending in "o"
            .replace(/(diciott|cent|miliard)esim[oaei]/, '$1o')
            // ending in "a"
            .replace(/(trent|quarant|cinquant|sessant|settant|ottant|novant)esim[oaei]/, '$1a');

        // now find the next part
        // note that in case of ambiguity ("tre" / "tredici") the left-most match in the regexp wins, not the longest
        const partregexp = /tredici|quattordici|quindici|sedici|diciasette|diciotto|diciannove|venti?|trenta?|quaranta?|cinquanta?|sessanta?|settanta?|ottanta?|novanta?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|cento?|mille|mila|milion[ei]|miliard[oi]|uno?|[0-9.,]+/y;

        let match = partregexp.exec(text);
        while (match !== null) {
            const part = match[0];
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
            match = partregexp.exec(text);
        }
        value += current;
        return value;
    }

    _normalizeNumber(num) {
        let wholepart, fracpart;
        if (num < 0) {
            wholepart = Math.ceil(num);
            fracpart = wholepart - num;
        } else {
            wholepart = Math.floor(num);
            fracpart = num - wholepart;
        }
        // fracpart will be a number between 0 and 1 so in decimal it will start as "0."...
        fracpart = String(fracpart).substring(2);
        if (fracpart)
            return `${wholepart},${fracpart}`;
        else
            return String(wholepart);
    }

    _parseDecimalNumber(text) {
        // remove any ".", replace "," with "." and remove any leading 0 or +
        let normalized = text.replace(/\./g, '').replace(/,/g, '.').replace(/^[0+]+/g, '');
        return parseFloat(normalized);
    }

    _initNumbers() {
        // numbers in digit

        // note: Italian uses "," as the decimal separator and "." as the thousand separator!
        // hence, the "normalized" form of numbers is different
        this._addDefinition('DIGITS', /[0-9]+(\.[0-9]+)*/);
        this._addDefinition('DECIMAL_NUMBER', /{DIGITS}(?:,{DIGITS})?/);

        this._lexer.addRule(/[+-]?{DECIMAL_NUMBER}/, (lexer) => {
            const value = this._parseDecimalNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, this._normalizeNumber(value));
        });

        // currencies
        this._lexer.addRule(/{DECIMAL_NUMBER}{WS}(dollar[oi]|euro(?:cent)?|cent|sterlin[ae]|pence|penny|yen|won|yuan|usd|cad|aud|chf|eur|gbp|cny|jpy|krw)/, (lexer) => {
            let [num, unit] = lexer.text.split(WS);
            let value = this._parseDecimalNumber(num);
            if (unit in CURRENCIES)
                unit = CURRENCIES[unit];
            if (unit.startsWith('0.01')) {
                value *= 0.01;
                unit = unit.substring(4);
            }

            return makeToken(lexer.index, lexer.text, this._normalizeNumber(value) + ' ' + unit, 'CURRENCY', { value, unit });
        });
        this._lexer.addRule(/(?:C\$|A\$|[$£€₩¥]){WS}?{DECIMAL_NUMBER}/, (lexer) => {
            let unit = lexer.text.match(/C\$|A\$|[$£€₩¥]/)[0];
            unit = CURRENCIES[unit];
            let num = lexer.text.replace(/(?:C\$|A\$|[$£€₩¥])/g, '').replace(WS, '');
            let value = this._parseDecimalNumber(num);
            return makeToken(lexer.index, lexer.text, this._normalizeNumber(value) + ' ' + unit, 'CURRENCY', { value, unit });
        });

        // numbers in words

        // - "zero" is not a number (cannot be compounded with other number words)
        // - "un"/"uno"/"una" are not normalized when alone
        // - small numbers (2 to 12) are normalized to digits
        // - other numbers are converted to NUMBER tokens

        // 2 to 9
        this._addDefinition('ONE_DIGIT_NUMBER', /due|tre|quattro|cinque|sei|sette|otto|nove/);

        // 2 to 12
        this._addDefinition('SMALL_NUMBER', /{ONE_DIGIT_NUMBER}|dieci|undici|dodici/);
        this._lexer.addRule(/{SMALL_NUMBER}/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, this._normalizeNumber(value));
        });

        // 13 to 19, or (20 to 90) optionally followed by ((- or whitespace) followed by 1 to 10)
        // special cases: when followed by 1 or 8 (which start with vowel)
        this._addDefinition('MEDIUM_NUMBER', /tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|(?:vent|trent|quarant|cinquant|sessant|settant|ottant|novant)(?:uno|otto)|(?:venti|trenta|quaranta|cinquanta|sessanta|settanta|ottanta|novanta)(?:due|tre|quattro|cinque|sei|sette|otto|nove)?/);

        // 100 and above
        // we accept both cause otherwise the grammar really gets out of hand

        // note: space is optional between number parts
        this._addDefinition('NUMBER_SEP', /{WS}?(?:e{WS})?/);

        // 1 to 99, as used by large and huge numbers
        this._addDefinition('LARGE_NUMBER_TRAIL', /{NUMBER_SEP}(uno|{SMALL_NUMBER}|{MEDIUM_NUMBER}|{DECIMAL_NUMBER})/);

        // 100 to 999
        // (unlike in English, you cannot use a 11-99 number with "cento"
        // "twenty two hundreds" would always be said as "duemiladuecento" aka "two thousands two hundreds")
        this._addDefinition('LARGE_NUMBER', /{ONE_DIGIT_NUMBER}?cento{LARGE_NUMBER_TRAIL}?/);

        // 1000 and above (1000 is a special case)
        // note that "milioni" and "miliardi" have a space but "mila" does not
        this._addDefinition('HUGE_NUMBER_CHUNK', /mille|(?:{SMALL_NUMBER}|{MEDIUM_NUMBER}|{LARGE_NUMBER}|{DECIMAL_NUMBER})mila|(?:un|{SMALL_NUMBER}|{MEDIUM_NUMBER}|{LARGE_NUMBER}|{DECIMAL_NUMBER}){WS}(milion[ei]|miliard[ei])/);
        this._addDefinition('HUGE_NUMBER', /{HUGE_NUMBER_CHUNK}(?:{NUMBER_SEP}{HUGE_NUMBER_CHUNK})*(?:{NUMBER_SEP}{LARGE_NUMBER}|{LARGE_NUMBER_TRAIL})?/);

        // medium, large and huge numbers are normalized
        this._lexer.addRule(/(?:{HUGE_NUMBER}|{LARGE_NUMBER}|{MEDIUM_NUMBER})(?!{LETTER})/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            return makeToken(lexer.index, lexer.text, this._normalizeNumber(value));
        });
    }

    _initOrdinals() {
        // ordinals in digits are written as digit followed by "º" (MASCULINE ORDINAL INDICATOR) or "ª" (FEMININE ORDINAL INDICATOR)
        // but those characters have a compatibility decomposition "o" and "a"
        // so we see "1o" and "1a"
        //
        // actual ASCII "o" is not quite as definitive compared to the ordinal indicator, so we do not
        // process ordinal numbers in any form, and simply split the number from the ordinal suffix
        // the neural parser will then learn when "a" and "o" are ordinal indicators and when they are not
        //
        // people also use "°" (DEGREE SIGN) in place of "º", because "°" is available on common keyboards
        // but we want to recognize temperatures, so we let that be its own token

        // ordinals in words

        // - "zeroth" is not an ordinal (cannot be compounded with other number words)
        // - the last digit of an ordinal >= 20 ("unesimo", "duesimo", etc.) is not the same as an ordinal < 10 (primo, secondo, terzo, etc.)
        // - small ordinals (1st to 12th) are untouched
        // - other ordinals are converted to NUMBER tokens

        // 1st to 9th
        this._addDefinition('ONE_DIGIT_ORDINAL', /(?:un|du|tre|quattr|cinqu|sei|sett|ott|nov)esim[oaei]/);
        this._addDefinition('SMALL_ORDINAL', /{ONE_DIGIT_ORDINAL}|undicesim[oaei]|undecim[oaei]|dodicesim[oaei]|duodecim[oaei]/);

        // 13th to 19th, or 20th, 30th, 40th, 50th, 60th, 70th, 80th, 90th, or  (20 to 90) followed by 1 to 10
        this._addDefinition('MEDIUM_ORDINAL', /(?:tredic|quattordic|quindic|sedic|diciasett|diciott|diciannov|vent|trent|quarant|cinquant|sessant|settant|ottant)esim[oaei]|(?:venti?|trenta?|quaranta?|cinquanta?|sessanta?|settanta?|ottanta?|novanta?){ONE_DIGIT_ORDINAL}/);

        // ending in 00th but not 000th: 100th, 200th, 300th, ... 1100th, 1200th, ...
        this._addDefinition('HUNDRED_LARGE_ORDINAL', /(?:{HUGE_NUMBER_CHUNK}{NUMBER_SEP})*(?:(?:{SMALL_NUMBER}|{MEDIUM_NUMBER}))?centesim[oaei]/);

        // ending in 000th: 1000th, 2000th, 22000th, 300000th, 1000000th, 1500000th, ...
        // note that "duemilionesimo" is ambiguous with "duemilione" so we need to do some regexp gymnastics to parse it properly
        this._addDefinition('THOUSAND_LARGE_ORDINAL', /{SMALL_NUMBER}?(?:millesim[oaei]|milionesim[oaei]|miliardesim[oaei])|(?:{HUGE_NUMBER}|{LARGE_NUMBER}|{MEDIUM_NUMBER})(?:millesim[oaei]|milionesim[oaei]|miliardesim[oaei])/);

        // 101th and above, excluding those ending in 00th
        this._addDefinition('OTHER_LARGE_ORDINAL', /(?:{HUGE_NUMBER}|{LARGE_NUMBER}){NUMBER_SEP}(?:{SMALL_ORDINAL}|{MEDIUM_ORDINAL})/);

        // medium and large ordinals are normalized
        this._lexer.addRule(/(?:{HUNDRED_LARGE_ORDINAL}|{THOUSAND_LARGE_ORDINAL}|{OTHER_LARGE_ORDINAL}|{MEDIUM_ORDINAL})(?!{LETTER})/, (lexer) => {
            const value = this._parseWordNumber(lexer.text);
            // normalize to a string without an ordinal marker (see above for why we cannot use "º")
            const normalized = String(value);
            return makeToken(lexer.index, lexer.text, normalized);
        });
    }

    _initTimes() {
        // Written Italian uses a simple 24 hour clock
        // Proper punctuation (as enforced by spellcheckers and autocomplete) uses ":" to separate hour minute and second
        // but it's common to see "." instead (and apparently some depraved people use "," too?)
        // "." makes too much confusion with numbers so we pretend it doesn't exist
        // hopefully speech to text won't give us too much grief
        super._initTimes();

        // Colloquial Italian, on the other hand, uses a 12 hour clock
        // but you would never see that in numeric form or with minutes
        // only with colloquial form like "tre del pomeriggio" (three in the afternoon) or
        // "sette e mezza di sera" (half past seven in the evening)
        // (more rarely, "sette e venti" (7:20) o "otto meno cinque" (five minutes to eight)
        //
        // These expressions are very ambiguous so we opt to let the neural network deal with it
        // (it's easy to synthesize enough training data with templates)
    }

    _extractWordMonth(text) {
        const word = /gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic/.exec(text.toLowerCase());
        return MONTHS[word[0]];
    }

    _parseWordDate(text, parseDay, parseYear, parseTime) {
        // this is the same logic as English (the order is the same as British English: day month year)
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

        this._addDefinition('ABBRV_DAY', /(?:lun|mar|mer|gio|ven|sab|dom)\./);
        // note: we're operating in NFKD so the accent is separate from the vowel it attaches to
        this._addDefinition('LONG_DAY', /(?:lune|marte|mercole|giove|vener)di\u0300|sabato|domenica/);

        // a number between 1 and 31
        // days are not ordinals in Italian, except for the first day of the month
        // see above for why we include ° (DEGREE SIGN) and "o" here
        this._addDefinition('NUMERIC_DAY', /1[oº°]|[12][0-9]|3[01]|[1-9]/);

        this._addDefinition('ABBRV_MONTH', /(?:gen|feb|mar|apr|mag|giu|lug|sett?|ott|nov|dic)\.?/);
        this._addDefinition('LONG_MONTH', /gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre/);

        // optional (day name followed by comma followed by whitespace), followed by day, optional "di" (= "of"), month
        // "Martedì, 7 Luglio", "1º Maggio", "30 Apr.", "2 di Agosto"
        this._addDefinition('DAY_MONTH', /(?:(?:{ABBRV_DAY}|{LONG_DAY}),?{WS})?{NUMERIC_DAY}{WS}(?:di{WS})?(?:{LONG_MONTH}|{ABBRV_MONTH})(?!{LETTER})/);
        // (unlike English, the month never precedes the day)

        // dates with words

        // day and month
        this._lexer.addRule(/{DAY_MONTH}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, null);
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // day, month and year
        this._lexer.addRule(/{DAY_MONTH}{WS}[0-9]{4}(?![0-9])/, (lexer) => {
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

        // day and month followed by comma, followed by optional "alle" or "all'" (= "at"), followed by a time
        this._lexer.addRule(/{DAY_MONTH},?{WS}(?:alle{WS}|all')?{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, false, (text) => this._parse12HrTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // day, month and year, followed by optional "alle" or "all'" (= "at"), followed by a time
        this._lexer.addRule(/{DAY_MONTH}{WS}[0-9]{4}(?![0-9]),?{WS}(?:alle{WS}|all')?{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parseWordDate(lexer.text, true, true, (text) => this._parse12HrTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // numeric dates

        // day/month/year
        this._addDefinition('NUMERIC_DATE', /(?:[12][0-9]|3[01]|0?[1-9])\/(?:1[012]|0?[1-9])\/[0-9]{4}(?![0-9])/);
        // day.month.year
        // day/month (only applicable with other signals that make it a date)
        this._addDefinition('NUMERIC_DATE_SHORT', /(?:[12][0-9]|3[01]|0?[1-9])\/(?:1[012]|0?[1-9])/);

        this._lexer.addRule(/{NUMERIC_DATE}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', null);
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });

        // with time
        this._lexer.addRule(/(?:{NUMERIC_DATE}|{NUMERIC_DATE_SHORT}),?{WS}(?:alle{WS}|all')?{PLAIN_TIME}/, (lexer) => {
            const parsed = this._parseNumericDate(lexer.text, 'dmy', (text) => this._parse12HrTime(text, ''));
            const normalized = this._normalizeDate(parsed);
            return makeToken(lexer.index, lexer.text, normalized, 'DATE', parsed);
        });
    }
}
