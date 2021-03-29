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
    // order is input, raw, processed, entities

    // note: stuff that is implemented by the base tokenizer is only tested for English

    // NFKD normalization
    // whatever my editor types
    ['chissà però più così perché', 'chissa\u0300 pero\u0300 piu\u0300 cosi\u0300 perche\u0301', 'chissa\u0300 pero\u0300 piu\u0300 cosi\u0300 perche\u0301', {}],
    // explicit NFC form
    ['chiss\u00e0 per\u00f2 pi\u00f9 cos\u00ec perch\u00e9', 'chissa\u0300 pero\u0300 piu\u0300 cosi\u0300 perche\u0301', 'chissa\u0300 pero\u0300 piu\u0300 cosi\u0300 perche\u0301', {}],
    // explicit NFD form
    ['chissa\u0300 pero\u0300 piu\u0300 cosi\u0300 perche\u0301', 'chissa\u0300 pero\u0300 piu\u0300 cosi\u0300 perche\u0301', 'chissa\u0300 pero\u0300 piu\u0300 cosi\u0300 perche\u0301', {}],

    // abbreviations
    ['Prof. Monica S. Lam',
     'prof. monica s. lam',
     'prof. monica s. lam', {}],
    ['Dott. Tizio Caio',
     'dott. tizio caio',
     'dott. tizio caio', {}],
    ['FIAT S.p.A.',
     'fiat s.p.a.',
     'fiat s.p.a.',
     {}],

    // phone numbers (note the intl. prefix is different!)
    ['call +123456789', 'call +123456789', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+123456789' }],
    ['call 333 123 4567', 'call +393331234567', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+393331234567' }],
    ['call 333 1234567', 'call +393331234567', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+393331234567' }],
    ['call 3331234567', 'call +393331234567', 'call PHONE_NUMBER_0', { PHONE_NUMBER_0: '+393331234567' }],

    // apostrophes and contractions
    ['l\'amaca, all\'amaca, un\'amaca', 'l\' amaca , all\' amaca , un\' amaca', 'l\' amaca , all\' amaca , un\' amaca', {}],

    // numbers and measurements
    ['almeno 3gb', 'almeno 3 gb', 'almeno 3 gb', {}],
    ['almeno 25gb', 'almeno 25 gb', 'almeno 25 gb', {}],
    ['almeno -3gb', 'almeno -3 gb', 'almeno -3 gb', {}],
    ['almeno -25gb', 'almeno -25 gb', 'almeno -25 gb', {}],
    ['almeno 1,75 gb', 'almeno 1,75 gb', 'almeno 1,75 gb', {}],
    ['almeno 1,75, e poi di più', 'almeno 1,75 , e poi di piu\u0300', 'almeno 1,75 , e poi di piu\u0300', {}],
    ['almeno 25, e poi di più', 'almeno 25 , e poi di piu\u0300', 'almeno 25 , e poi di piu\u0300', {}],
    ['almeno 25.000 e poi di più', 'almeno 25000 e poi di piu\u0300', 'almeno 25000 e poi di piu\u0300', {}],
    ['almeno 25.00 e poi di più', 'almeno 2500 e poi di piu\u0300', 'almeno 2500 e poi di piu\u0300', {}],
    ['almeno uno', 'almeno uno', 'almeno uno', {}],
    ['almeno una', 'almeno una', 'almeno una', {}],
    ['almeno cinque', 'almeno 5', 'almeno 5', {}],
    ['almeno dodici', 'almeno 12', 'almeno 12', {}],
    ['almeno tredici', 'almeno 13', 'almeno 13', {}],
    ['almeno venti', 'almeno 20', 'almeno 20', {}],
    ['almeno ventuno', 'almeno 21', 'almeno 21', {}],
    ['almeno ventidue', 'almeno 22', 'almeno 22', {}],
    ['almeno ventinove', 'almeno 29', 'almeno 29', {}],
    ['almeno novantuno', 'almeno 91', 'almeno 91', {}],
    ['almeno novantadue', 'almeno 92', 'almeno 92', {}],
    ['almeno un milione', 'almeno 1000000', 'almeno 1000000', {}],
    ['almeno due milioni', 'almeno 2000000', 'almeno 2000000', {}],
    ['almeno un milione duemilatre', 'almeno 1002003', 'almeno 1002003', {}],
    ['almeno un milione duecentomila e tre', 'almeno 1200003', 'almeno 1200003', {}],
    ['almeno un milione duecentomilatre', 'almeno 1200003', 'almeno 1200003', {}],
    ['almeno 1,75 miliardi', 'almeno 1750000000', 'almeno 1750000000', {}],
    ['almeno cento', 'almeno 100', 'almeno 100', {}],
    ['almeno mille', 'almeno 1000', 'almeno 1000', {}],
    ['almeno duemiladuecento', 'almeno 2200', 'almeno 2200', {}],
    ['almeno duemilatrecentoquarantacinque', 'almeno 2345', 'almeno 2345', {}],
    ['almeno trecentomila', 'almeno 300000', 'almeno 300000', {}],
    ['almeno trecentoquindicimila', 'almeno 315000', 'almeno 315000', {}],

    // ordinals
    ['voglio il 1º', 'voglio il 1 o', 'voglio il 1 o', {}],
    ['voglio la 1ª', 'voglio la 1 a', 'voglio la 1 a', {}],
    ['voglio il 13º', 'voglio il 13 o', 'voglio il 13 o', {}],
    ['voglio il 21º', 'voglio il 21 o', 'voglio il 21 o', {}],
    ['voglio il primo', 'voglio il primo', 'voglio il primo', {}],
    ['voglio il quinto', 'voglio il quinto', 'voglio il quinto', {}],
    ['voglio il dodicesimo', 'voglio il dodicesimo', 'voglio il dodicesimo', {}],
    ['voglio il tredicesimo', 'voglio il 13', 'voglio il 13', {}],
    ['voglio il ventesimo', 'voglio il 20', 'voglio il 20', {}],
    ['voglio il ventunesimo', 'voglio il 21', 'voglio il 21', {}],
    ['voglio il ventiduesimo', 'voglio il 22', 'voglio il 22', {}],
    ['voglio il ventinovesimo', 'voglio il 29', 'voglio il 29', {}],
    ['voglio il novantunesimo', 'voglio il 91', 'voglio il 91', {}],
    ['voglio il milionesimo', 'voglio il 1000000', 'voglio il 1000000', {}],
    ['voglio il un milione duemilatreesimo', 'voglio il 1002003', 'voglio il 1002003', {}],
    ['voglio il duemilionesimo', 'voglio il 2000000', 'voglio il 2000000', {}],
    ['voglio il duemiliardesimo', 'voglio il 2000000000', 'voglio il 2000000000', {}],
    ['voglio il centesimo', 'voglio il 100', 'voglio il 100', {}],
    ['voglio il millesimo', 'voglio il 1000', 'voglio il 1000', {}],
    ['voglio il duemiladuecentesimo', 'voglio il 2200', 'voglio il 2200', {}],
    ['voglio il duemilatrecentoquarantacinquesimo', 'voglio il 2345', 'voglio il 2345', {}],
    ['voglio il trecentomillesimo', 'voglio il 300000', 'voglio il 300000', {}],
    ['voglio il trecentoquindicimillesimo', 'voglio il 315000', 'voglio il 315000', {}],
    ['voglio il trecentoquindicimiladuesimo', 'voglio il 315002', 'voglio il 315002', {}],

    // currencies
    ['costa $50', 'costa 50 usd', 'costa CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['costa $ 50', 'costa 50 usd', 'costa CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['costa $1,00', 'costa 1 usd', 'costa CURRENCY_0', { CURRENCY_0: { value: 1, unit: 'usd' }}],
    ['costa $1.000', 'costa 1000 usd', 'costa CURRENCY_0', { CURRENCY_0: { value: 1000, unit: 'usd' }}],
    ['costa C$50', 'costa 50 cad', 'costa CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'cad' }}],
    ['costa €50', 'costa 50 eur', 'costa CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'eur' }}],
    ['costa 50 dollari', 'costa 50 usd', 'costa CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['costa 50 euro', 'costa 50 eur', 'costa CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'eur' }}],
    ['costa 50 yuan', 'costa 50 cny', 'costa CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'cny' }}],

    // times

    ['svegliami alle 7:15', 'svegliami alle 7:15:00', 'svegliami alle TIME_0', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['svegliami alle 7:15:22', 'svegliami alle 7:15:22', 'svegliami alle TIME_0', { TIME_0: { hour: 7, minute: 15, second: 22 } }],
    ['svegliami alle 3:15', 'svegliami alle 3:15:00', 'svegliami alle TIME_0', { TIME_0: { hour: 3, minute: 15, second: 0 } }],
    ['svegliami alle 15:15', 'svegliami alle 15:15:00', 'svegliami alle TIME_0', { TIME_0: { hour: 15, minute: 15, second: 0 } }],
    ['svegliami alle 19:15', 'svegliami alle 19:15:00', 'svegliami alle TIME_0', { TIME_0: { hour: 19, minute: 15, second: 0 } }],

    // ambiguous cases are handled by the parser (treated as "small numbers")
    ['svegliami alle 7', 'svegliami alle 7', 'svegliami alle 7', {}],
    ['svegliami alle 7 del mattino', 'svegliami alle 7 del mattino', 'svegliami alle 7 del mattino', {}],
    ['svegliami alle 7 del pomeriggio', 'svegliami alle 7 del pomeriggio', 'svegliami alle 7 del pomeriggio', {}],

    // dates
    ['1 giugno', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['1° giugno', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['1º giugno', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['1 giugno 2020', '2020-06-01', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['1 dicembre', 'XXXX-12-01', 'DATE_0', { DATE_0: { year: -1, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['1 dicembre 2020', '2020-12-01', 'DATE_0', { DATE_0: { year: 2020, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['3 apr.', 'XXXX-04-03', 'DATE_0', { DATE_0: { year: -1, month: 4, day: 3, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['3 apr. 2020', '2020-04-03', 'DATE_0', { DATE_0: { year: 2020, month: 4, day: 3, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['5 maggio', 'XXXX-05-05', 'DATE_0', { DATE_0: { year: -1, month: 5, day: 5, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['5 maggio 2020', '2020-05-05', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 5, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['5 maggio 2020', '2020-05-05', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 5, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['23 giugno 2020', '2020-06-23', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 23, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['giugno 2020', '2020-06-XX', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: -1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['giugno 2020, da qualche parte', '2020-06-XX , da qualche parte', 'DATE_0 , da qualche parte', { DATE_0: { year: 2020, month: 6, day: -1, hour: 0, minute: 0, second: 0, timezone: undefined } }],

    // with times
    ['1 giugno all\'1:15', 'XXXX-06-01T01:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 1, minute: 15, second: 0, timezone: undefined } }],
    ['1 giugno alle 7:15', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['1 giugno, alle 7:15', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['1 giugno, 7:15', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['1 giugno alle 3:15', 'XXXX-06-01T03:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],

    // again, with years
    ['1 giugno 2020 all\'1:15', '2020-06-01T01:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 1, minute: 15, second: 0, timezone: undefined } }],
    ['1 giugno 2020 alle 7:15', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['1 giugno 2020, alle 7:15', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['1 giugno 2020, 7:15', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['1 giugno 2020 alle 3:15', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],

    // numeric dates
    ['18/05/2020', '2020-05-18', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 18, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['18/5/2020', '2020-05-18', 'DATE_0', { DATE_0: { year: 2020, month: 5, day: 18, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['05/12/2020', '2020-12-05', 'DATE_0', { DATE_0: { year: 2020, month: 12, day: 5, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    // invalid dates and fractions
    ['05/18/2020', '5 / 18 / 2020', '5 / 18 / 2020', {}],
    ['05/32/2020', '5 / 32 / 2020', '5 / 32 / 2020', {}],
    ['32/05/2020', '32 / 5 / 2020', '32 / 5 / 2020', {}],
    ['05/18', '5 / 18', '5 / 18', {}],

    // numeric dates and times
    ['1/6 alle 7:15', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['1/6/2020 alle 3:15', '2020-06-01T03:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 3, minute: 15, second: 0, timezone: undefined } }],
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
];

function main() {
    const langPack = I18n.get('it-IT');
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
