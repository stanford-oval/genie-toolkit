// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2021 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Naoki Yamamura <yamamura@cs.stanford.edu>
//         Silei Xu <silei@cs.stanford.edu>

import assert from 'assert';
import * as ThingTalk from 'thingtalk';

import { CsqaConverter } from '../../tool/autoqa/wikidata/csqa-converter';

const manifest = `class @org.wikidata {
    list query country(out id : Entity(org.wikidata:country), 
                       out official_language : Array(Entity(org.wikidata:p_official_language)),
                       out named_after : Array(Entity(org.wikidata:p_named_after)),
                       out legislative_body : Array(Entity(org.wikidata:p_legislative_body)),
                       out located_in_or_next_to_body_of_water : Array(Entity(org.wikidata:p_located_in_or_next_to_body_of_water)),
                       out diplomatic_relation : Array(Entity(org.wikidata:p_diplomatic_relation)), 
                       out shares_border_with : Array(Entity(org.wikidata:p_shares_border_with)));
}`;

const PROPERTIES = {
    P17: 'country',
    P27: 'country of citizenship',
    P35: 'head of state',
    P37: 'official language',
    P47: 'shares border with',
    P138: 'named after',
    P194: 'legislative body',
    P206: 'located in or next to body of water',
    P291: 'place of publication',
    P463: 'member of',
    P530: 'diplomatic relation',
    P921: 'main subject',
};
const ITEMS = {
    Q16: 'Canada',
    Q27: 'Ireland',
    Q30: 'United States of America ',
    Q38: 'Italy',
    Q142: 'France',
    Q145: 'United Kingdom',
    Q159: 'Russia',
    Q183: 'Germany',
    Q230: 'Georgia',
    Q403: 'Serbia',
    Q414: 'Argentina',
    Q869: 'Thailand',
    Q916: 'Angola'
};
const VALUES = {
    Q16: 'Canada',
    Q27: 'Ireland',
    Q30: 'United States of America ',
    Q38: 'Italy',
    Q142: 'France',
    Q145: 'United Kingdom',
    Q159: 'Russia',
    Q183: 'Germany',
    Q230: 'Georgia',
    Q403: 'Serbia',
    Q414: 'Argentina',
    Q869: 'Thailand',
    Q916: 'Angola',
    Q34770: 'language',
    Q43482: 'Franks',
    Q56004: 'Corvey',
    Q111466: 'Pontoglio',
    Q191067: 'article',
    Q360469: 'Charles III, Duke of Parma',
    Q484652: 'international organization',
    Q502895: 'common name',
    Q838948: 'work of art',
    Q1048835: 'political territorial entity',
    Q11103562: 'Higashine interchange',
    Q12318599: 'Isabelle Brockenhuus-Løwenhielm',
    Q15617994: 'designation for an administrative territorial entity',
    Q214646: "Dambovita River",
    Q1598984: "Jihlava",
    Q1860: "English",
    Q1321: "Spanish",
    Q150: "French"

};

const TEST_CASES = [
    // Some of the following examples are faked, i.e., they might not be in CSQA dataset
    // 1. Simple Question (subject-based)
    ['1', {  
        user: {
            ques_type_id: 1,
            utterance: 'Who is the head of state of Angola ?',
            sec_ques_type: 1 },
        system: { 
            utterance: 'José Eduardo dos Santos',
            active_set: [ '(Q916,P35,c(Q502895))' ],
        } },
    '[head_of_state] of @org.wikidata.country() filter id == "Q916"^^org.wikidata:country("angola")'],
    // 2.1. Secondary question, Subject based question
    ['2.1', {  
        user: {
            ques_type_id: 2,  
            sec_ques_sub_type: 1,  
            sec_ques_type: 1,
            utterance: 'Which assembly governs France ?' },
        system: {
            utterance: 'French Parliament',
            active_set: [ '(Q142,P194,c(Q1752346))' ],
        } },
    '[legislative_body] of @org.wikidata.country() filter id == "Q142"^^org.wikidata:country("france")'],
    // 2.4. Secondary question, Subject based question, plural
    ['2.4.1', {  
        user: {
            ques_type_id: 2,  
            sec_ques_sub_type: 4,  
            sec_ques_type: 1,
            utterance: 'Which assembly governs France, Canada, and Ireland?' },
        system: {
            utterance: 'French Parliament',
            active_set: [ '(Q142,P194,c(Q1752346))', '(Q16,P194,c(Q1752346))', '(Q27,P194,c(Q1752346))' ],
        } },
    '[legislative_body] of @org.wikidata.country() filter id == "Q142"^^org.wikidata:country("france") || id == "Q16"^^org.wikidata:country("canada") || id == "Q27"^^org.wikidata:country("ireland")'],
    // 2.4. Secondary question, Subject based question, plural
    // this is often ambiguous from set-based question in CSQA
    ['2.4.2', {  
        user: {
            ques_type_id: 2,  
            sec_ques_sub_type: 4,  
            sec_ques_type: 2,
            utterance: 'Which country have official language English, Spanish, and French, respectively ?' },
        system: {
            utterance: '???',
            active_set: [ 'c(Q6256),P37,Q1860)', '(c(Q6256),P37,Q1321)', '(c(Q6256),P37,Q150)' ],
        } },
    '@org.wikidata.country() filter contains(official_language, "Q1860"^^org.wikidata:p_official_language("english")) || contains(official_language, "Q1321"^^org.wikidata:p_official_language("spanish")) || contains(official_language, "Q150"^^org.wikidata:p_official_language("french"))'],
    // 2.2. Secondary question, Object based question 
    ['2.2', {  
        user: {
            ques_type_id: 2,
            sec_ques_sub_type: 1,
            sec_ques_type: 2,
            utterance: 'Which country is named after Franks ?' },
        system: {
            utterance: 'France',
            active_set: [ '(c(Q6256),P138,Q43482)' ],
        } },
    '@org.wikidata.country() filter contains(named_after, "Q43482"^^org.wikidata:p_named_after("franks"))'],
    // 4.1. Set-based question OR
    ['4.1.1', {  
        user: {
            set_op_choice: 1,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which country are situated close to Dâmboviţa River or Jihlava ?' },
        system: {
          utterance: 'Romania, Czechia',
          active_set: [ 'OR((c(Q6256),P206,Q214646)), (c(Q6256),P206,Q1598984))' ],
        } },
    '@org.wikidata.country() filter contains(located_in_or_next_to_body_of_water, "Q214646"^^org.wikidata:p_located_in_or_next_to_body_of_water("dambovita river")) || contains(located_in_or_next_to_body_of_water, "Q1598984"^^org.wikidata:p_located_in_or_next_to_body_of_water("jihlava"))'],
    // 4.1. Set-based question OR
    ['4.1.2', {  
        user: {
            set_op_choice: 1,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which political territories have a diplomatic relationship or share border with United States of America ?' },
        system: {
            utterance: 'Australia, Canada',
            active_set: [ 'OR((Q30,P530,c(Q1048835)), (Q30,P47,c(Q1048835)))' ] } },
    '[diplomatic_relation, shares_border_with] of @org.wikidata.country() filter id == "Q30"^^org.wikidata:country("united states of america")'],
    // 4.1. Set-based question OR
    // TODO: not supported yet, requires union operator in thingtalk, or a subquery
    /*
    ['4.1.3', {  
        user: {
        set_op_choice: 1,
        ques_type_id: 4,
        is_inc: 0,
        utterance: 'Which political territories have a diplomatic relationship with United States of America or Canada ?' },
    system: {
        utterance: 'Australia',
        active_set: [ 'OR((Q30,P530,c(Q1048835)), (Q16,P530,c(Q1048835)))' ]}},
    '([diplomatic_relation] of @org.wikidata.country(), filter id == "Q30"^^org.wikidata:country("united states of america") union (([diplomatic_relation] of @org.wikidata.country(), filter id == "Q16"^^org.wikidata:country("canada"))'],
    */
   //4.2. Set-based question AND
    ['4.2.1', {  
        user: {
            set_op_choice: 2,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which country has official language English and Spanish ?' },
        system: { 
            utterance: 'United States of America',
            active_set: [ 'AND((c(Q6256),P37,Q1860), (c(Q6256),P37,Q1321))' ] } },
    '@org.wikidata.country() filter contains(official_language, "Q1860"^^org.wikidata:p_official_language("english")) && contains(official_language, "Q1321"^^org.wikidata:p_official_language("spanish"))'],
    // 4.2. Set-based question AND
    // TODO: not supported yet, multiple domains, and requires intersection operator in thingtalk or subquery
    /*
    ['4.2.2', {  
        user: {
            set_op_choice: 2,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which administrative territories share border with France and are Charles III, Duke of Parma a civilian of ?' },
        system: {
            utterance: 'Kingdom of the Netherlands',
            active_set: [ 'AND((Q142,P47,c(Q15617994)), (Q360469,P27,c(Q15617994)))' ],
    }},
    '([shares_border_with] of @org.wikidata.country() filter id == "Q142"^^org.wikidata:country("france")) intersect ([country_of_citizenship] of @org.wikidata.person() filter id === "Q360469"^^org.wikidata:person("charles iii, duke of parma"))'],
    */
    // 4.3. Set-based question Difference
    ['4.3.1', {  
        user: {
            set_op_choice: 3,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which country has official language English but not Spanish ?' },
        system: { 
            utterance: 'France, Zambia',
            active_set: [ 'AND((c(Q6256),P37,Q1860), NOT((c(Q6256),P37,Q1321)))' ],
        } },
    '@org.wikidata.country() filter contains(official_language, "Q1860"^^org.wikidata:p_official_language("english")) && !contains(official_language, "Q1321"^^org.wikidata:p_official_language("spanish"))'],
    // 4.3. Set-based question Difference
    // TODO: not supported yet, requires diff operator in thingtalk or a subquery
    /*
    ['4.3.2', {  
        user: {
            set_op_choice: 3,
            ques_type_id: 4,
            is_inc: 0,
            utterance: 'Which administrative territories have diplomatic relationships with Ireland but not Canada ?' },
        system: { 
            utterance: 'France, Zambia',
            active_set: [ 'AND((Q27,P530,c(Q15617994)), NOT((Q16,P530,c(Q15617994))))' ],
    }},
    '([diplomatic_relation] of @org.wikidata.country() filter id == "Q27"^^org.wikidata:country("ireland")) - ([diplomatic_relation] of @org.wikidata.country() filter id == "Q16"^^org.wikidata:country("canada"))'],
    */
    // 5.1 Verification, 1 subject, 2 object
    ['5.1', {  
        user: {
            bool_ques_type: 1,
            ques_type_id: 5,
            utterance: 'Does Canada have official language English ?' },
        system: { 
            utterance: 'Yes',
            active_set: [ '(Q16, P37, Q1860)' ],
        } },
    '[contains(official_language, "Q1860"^^org.wikidata:p_official_language("english"))] of @org.wikidata.country() filter id == "Q16"^^org.wikidata:country("canada")'],
    // 5.4 Verification, 1 subject, 1 object
    ['5.4', {  
        user: {
            bool_ques_type: 4,
            ques_type_id: 5,
            utterance: 'Does Canada have official language English and Spanish?' },
        system: { 
            utterance: 'Yes and No respectively',
            active_set: [ '(Q16, P37, Q1860)', '(Q16, P37, Q1321)' ],
        } },
    '[contains(official_language, "Q1860"^^org.wikidata:p_official_language("english")) && contains(official_language, "Q1321"^^org.wikidata:p_official_language("spanish"))] of @org.wikidata.country() filter id == "Q16"^^org.wikidata:country("canada")'],
    // 7.1. Comparative and Quantitative questions (involving single entity), Quantitative (count) single entity
    ['7.1.1', {  
        user: {
            ques_type_id: 7,
            count_ques_sub_type: 1,
            count_ques_type: 1,
            utterance: 'How many administrative territories have diplomatic relationships with Argentina ?',
            is_incomplete: 0 },
        system: { 
            utterance: '4',
            active_set: [ '(Q414,P530,c(Q15617994))' ],
        } },
    '[count(diplomatic_relation)] of @org.wikidata.country() filter id == "Q414"^^org.wikidata:country("argentina")'],
    // 7.1. Comparative and Quantitative questions (involving single entity), Quantitative (count) single entity
    ['7.1.2', {  
        user: {
            ques_type_id: 7,
            count_ques_sub_type: 1,
            count_ques_type: 1,
            utterance: 'How many countries has official language English ?',
            is_incomplete: 0 },
        system: { 
            utterance: '??',
            active_set: [ '(c(Q6256), P37, Q1860)' ],
        } },
    'count(@org.wikidata.country() filter contains(official_language, "Q1860"^^org.wikidata:p_official_language("english")))'],
    // 7.2. Comparative and Quantitative questions (involving single entity), Quantitative (max/min) single entity
    ['7.2', {  
        user: {
            ques_type_id: 7,
            count_ques_sub_type: 2,
            count_ques_type: 2,
            utterance: 'Which country has the max number of official languages ?',
            is_incomplete: 0 },
        system: { 
            utterance: '???',
            active_set: [ '(c(Q6256),P37,c(Q34770))' ],
        } },
    'sort(count desc of [count(official_language)] of @org.wikidata.country())[1]'],
    // 7.3. Comparative and Quantitative questions (involving single entity), Quantitative (<=, >=, ==, ~~) single entity
    ['7.3', {  
        user: {
            ques_type_id: 7,
            count_ques_sub_type: 3,
            count_ques_type: 1,
            utterance: 'Which country has the atmost 2 official languages ?',
            is_incomplete: 0 },
        system: { 
            utterance: '???',
            active_set: [ '(c(Q6256),P37,c(Q34770))' ],
        } },
    '@org.wikidata.country() filter count(official_language) <= 2'],
    // 7.4. Comparative and Quantitative questions (involving single entity), Comparative (more/less/~~) single entity
    ['7.4', {  
        user: {
            ques_type_id: 7,
            count_ques_sub_type: 4,
            count_ques_type: 1,
            entities_in_utterance: ['Q16'],
            utterance: 'Which country has the more official languages than Canada?',
            is_incomplete: 0 },
        system: { 
            utterance: '???',
            active_set: [ '(c(Q6256),P37,c(Q34770))' ],
        } },
    '@org.wikidata.country() filter count(official_language) >= any([count(official_language)] of @org.wikidata.country() filter id == "Q16"^^org.wikidata:country("canada"))'],
    // 7.5. Comparative and Quantitative questions (involving single entity), Quantitative (count over <=, >=, ==, ~~) single entity
    ['7.5', {  
        user: {
            ques_type_id: 7,
            count_ques_sub_type: 5,
            count_ques_type: 1,
            utterance: 'How many country has the atmost 2 official languages ?',
            is_incomplete: 0 },
        system: { 
            utterance: '???',
            active_set: [ '(c(Q6256),P37,c(Q34770))' ],
        } },
    'count(@org.wikidata.country() filter count(official_language) <= 2)'],
    // 7.6. Comparative and Quantitative questions (involving single entity), Comparative (count over more/less/~~) single entity
    ['7.6', {  
        user: {
            ques_type_id: 7,
            count_ques_sub_type: 6,
            count_ques_type: 1,
            entities_in_utterance: ['Q16'],
            utterance: 'How many country has the more official languages than Canada?',
            is_incomplete: 0 },
        system: { 
            utterance: '???',
            active_set: [ '(c(Q6256),P37,c(Q34770))' ],
        } },
    'count(@org.wikidata.country() filter count(official_language) >= any([count(official_language)] of @org.wikidata.country() filter id == "Q16"^^org.wikidata:country("canada")))'],
    // 8.1. Comparative and Quantitative questions (involving multiple(2) entities), Quantitative with Logical Operators
    ['8.1.1', {  
        user: {
            set_op: 1,
            ques_type_id: 8,
            count_ques_sub_type: 1,
            count_ques_type: 1,
            utterance: 'How many countries have official language English and Spanish ?',
            is_incomplete: 0 },
       system: { 
            utterance: '2',
            active_set: [ '(c(Q6256), P37, Q1860)', '(c(Q6256), P37, Q1321)' ]
       } },
    'count(@org.wikidata.country() filter contains(official_language, "Q1860"^^org.wikidata:p_official_language("english")) && contains(official_language, "Q1321"^^org.wikidata:p_official_language("spanish")))'],
    // 8.1. Comparative and Quantitative questions (involving multiple(2) entity), Quantitative with Logical Operators
    // TODO: not supported, similar to the corresponding set-based questions
    /*
    ['8.1.2', {  
        user: {
            set_op: 1,
            ques_type_id: 8,
            count_ques_sub_type: 1,
            utterance: 'How many administrative territories have diplomatic relationships with Argentina and Canada?',
            is_incomplete: 0 },
        system: { 
            utterance: '4',
            active_set: [ '(Q414,P530,c(Q15617994))', '(Q16,P530,c(Q15617994))' ],
    }},
    '[count(diplomatic_relation)] of (@org.wikidata.country() filter id == "Q414"^^org.wikidata:country("argentina")) union (@org.wikidata.country() filter id == "Q16"^^org.wikidata:country("canada"))'],
    */
    // 8.2. Comparative and Quantitative questions (involving multiple(2) entities), Quantitative (count) multiple entity
    // TODO: not supported yet, requires type constraint on the projection
    /*
    ['8.2', {  
        user: {
            set_op: 2,
            ques_type_id: 8,
            count_ques_sub_type: 2,
            count_ques_type: 1,
            utterance: 'How many administrative territories or political territories have a diplomatic relationship with France ?',
            is_incomplete: 0 },
        system: {
            utterance: '18',
            active_set: [ '(Q142,P530,c(Q15617994))', '(Q142,P530,c(Q1048835))' ],
    }},
    '(count[diplomatic_relation^^org.wikidata.administrative_territories|org.wikidata.political_territories] of @org.wikidata.country() filter id == "Q142"^^org.wikidata:country("france")'],
    */

];

export default async function main() {
    const csqaConverter = new CsqaConverter({
        includeEntityValue: true
    });
    csqaConverter._domains = {
        getDomainByCSQAType: function(csqaType) {
            return csqaType === 'Q6256' ? 'country' : null;
        } 
    };
    csqaConverter._items = new Map([['country', ITEMS]]);
    csqaConverter._values = new Map(Object.entries(VALUES));
    csqaConverter._wikidataProperties = new Map(Object.entries(PROPERTIES));
    csqaConverter._classDef = ThingTalk.Syntax.parse(manifest, ThingTalk.Syntax.SyntaxType.Normal, { locale : 'en-US', timezone: undefined }).classes[0];

    for (let i = 0; i < TEST_CASES.length; i++) {
        const [id, dialog, expected] = TEST_CASES[i];
        console.log(`TEST CASE #${id}`);
        const generated = (await csqaConverter.csqaToThingTalk(dialog)).prettyprint();
        assert.strictEqual(generated, expected);
    }
}
if (!module.parent) main();