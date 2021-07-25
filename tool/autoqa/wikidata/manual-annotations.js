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
// Author: Silei Xu <silei@cs.stanford.edu>

import { Type } from 'thingtalk';

const PROPERTY_TYPE_OVERRIDE = {
    'P166': new Type.Array(new Type.Entity('org.wikidata:award')), // award_received
    'P1411': new Type.Array(new Type.Entity('org.wikidata:award')), // nominated_for
    'P106': new Type.Array(new Type.Entity('org.wikidata:occupation')), // occupation
    'P26': new Type.Array(new Type.Entity('org.wikidata:human')), // spouse (it misses no "value type constraint" property)
    'P21': new Type.Enum(['female', 'male']),
    'P17': new Type.Entity('org.wikidata:country'), // country
    'P2295': Type.Currency, // net profit (it misses no allowed unit property)
    'P2031': Type.Date, // work_period_start
    'P2032': Type.Date, // work_period_end
    'P172': new Type.Array(new Type.Entity('org.wikidata:ethnic_group')), // ethnic_group
    'P1344': new Type.Array(new Type.Entity('org.wikidata:event')), //participant_in
    'P54': new Type.Array(new Type.Entity('org.wikidata:sports_team')), // member_of_sports_team
    'P647': new Type.Entity('org.wikidata:sports_team'), // drafted by
    'P1618': new Type.Array(Type.Number), // sport_number
    'P1352': Type.Number, // ranking
    'P1303': new Type.Array(new Type.Entity('org.wikidata:musical_instrument')), // instrument
    'P264': new Type.Array(new Type.Entity('org.wikidata:record_label')), // record_label
    'P361': new Type.Array(Type.String), // part_of
    'P398': new Type.Array(new Type.Entity('org.wikidata:star')), // child_astronomical_body
    'P397': new Type.Array(new Type.Entity('org.wikidata:star')), // parent_astronomical_body
    'P2227': Type.Number, // metallicity
    'P85': new Type.Entity('org.wikidata:song'), // anthem
    'P942': new Type.Entity('org.wikidata:song'), // theme_music
    'P36': new Type.Entity('org.wikidata:city'), // capital
    'P206': new Type.Array(Type.String), // located_in_or_next_to_body_of_water
    'P610': Type.Location, // highest point
    'P1589': Type.Location, // lowest point
    'P27': new Type.Entity('org.wikidata:country'), // country of citizenship
};

// properties that should have the same type as the subject
const PROPERTY_TYPE_SAME_AS_SUBJECT = new Set([
    'P190', // twinned_administrative_body
    'P47', // shares_border_with
    'P530', // diplomatic_relation
]);

const PROPERTY_FORCE_ARRAY = new Set([
    'P1449', // nickname
    'P1813', // short name
    'P206', // located_in_or_next_to_body_of_water
    'P190', // twinned_administrative_body
    'P47', // shares_border_with
    'P112', // founded_by
    'P488', // chair person
    'P2828', // corporate_officer
    'P452', // industry,
    'P1056', // product_or_material_produced
    'P39', // position_held
    'P3373', // sibling
    'P40', // children
    'P1412', // languages_spoken_written_or_signed
    'P1830', // owner_of
    'P127', // owned_by
    'P859', // sponsor
    'P551', // residence
    'P1344', // participant_in,
    'P641', // sport
    'P413', // position_played_on_team_or_speciality,
    'P118', // league
    'P412', // voice type
    'P800', // notable_work (this will be just array of string, wikidata doesn't have 'creative work'
    'P37', // official language
    'P6', // head of government
    'P150', // contains_administrative_territorial_entity,
    'P421', // time zone
    'P170', // creator
    'P58', // screenwriter
    'P161', // cast member
    'P162', // producer
    'P674', // characters
]);

const PROPERTY_FORCE_NOT_ARRAY = new Set([

]);



const MANUAL_PROPERTY_CANONICAL_OVERRIDE = {
    'id': {
        passive_verb: ["named #", "called #"],
        property: ["name #"]
    },
    'capital_of': {
        property: ["capital of #"],
        reverse_property: ["# capital", "#'s capital"],
    },
    'located_in_time_zone': {
        passive_verb: ["located in # time zone"],
        preposition: ["in # time zone", "in # time"],
    },
    'sister_city': {
        property: ["sister city #", "sister city of #", "sister town of #"],
    },
    'legislative_body': {
        base: ["legislature", "assembly"],
        property: ["#"],
    },
    'country': {
        preposition: ["in #", "part of #"],
    },
    // not in eval set
    // 'list_of_monuments': {},
    'head_of_government': {
        property: ["head of government #", "leader #"],
    },
    'located_next_to_body_of_water': {
        preposition: ["next to #", "located next to #"],
        verb: ["borders #"],
        passive_verb: ["located next to #"]
    },
    // not in eval set
    // 'architectural_style': {},
    'flag': {
        base: ["flag"],
        verb: ["associate with"],
    },
    'coat_of_arms': {
        base: ["coat of arms"],
    },
    'shares_border_with': {
        verb: ["shares border with #", "borders #"],
        preposition: ["next to #"],
        passive_verb: ["located next to #"]
    },
    'founder': {
        passive_verb: ["founded by #"]
    },
    'part_of': {
        preposition: ["part of #"],
    },
    'office_held_by_head_of_government': {
        property: ['a #'],
        passive_verb: ["lead by #", "governed by #", "run by #"],
    },
    'official_language': {
        property: ["official language #"]
    },
    'applies_to_jurisdiction': {
        // not in eval set
    },
    'patron_saint': {
        base: ["patron saint"],
    },
    // eval set only contains noise for this
    // 'contains_settlement': {},
    'award_received': {
        property: ['# award'],
        verb: ["has # award"]
    },
    'located_on_terrain_feature': {
        passive_verb: ["located on #", "located on a #"],
        preposition: ["on #", "on a #"]
    },
    // not in eval set
    //'heritage_status': {},
    'continent': {
        preposition: ["in #", "within #"]
    },
    'named_after': {
        passive_verb: ["named after #"],
        property: ["namesake #"]
    },
    'from_fictional_universe': {
        preposition: ["from #", "from the fictional universe #"]
    },
    'highest_point': {
        property: ["highest point #"]
    },
    // not in eval set
    //'appointed_by': {},
    'member_of': {
        reverse_property: ["# member"],
        property: ["member of #"]
    },
    'capital': {
        base: ["capital"],
    },
    'headquarters_location': {
        base: ["headquarters", "head office", "main office"],
    },
    // not in eval set
    //'diocese': {},
    'currency': {
        property: ["currency #"],
    },
    // not in eval set
    //'present_in_work': {},
    // not in eval set
    //'significant_event': {},
    // TODO
    //'stated_in': {},
    // TODO
    //'subsidiary': {},
    // TODO
    //'work_location': {},
    'architect': {
        property: ["architect #"],
        passive_verb: ["built by #", "designed by #"],
    },
};

const MANUAL_TABLE_CANONICAL_OVERRIDE = {

};

const PROPERTIES_NO_FILTER = [

];

const STRING_FILE_OVERRIDES = {
};


export {
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE,

    PROPERTY_TYPE_OVERRIDE,
    PROPERTIES_NO_FILTER,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_TYPE_SAME_AS_SUBJECT,

    STRING_FILE_OVERRIDES
};
