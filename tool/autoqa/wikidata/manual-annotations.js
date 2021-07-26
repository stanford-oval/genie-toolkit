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
    'P1376': {
        base_projection: ['administrative territory', 'administrative territories', 'political territory', 'political territories'],
        reverse_property: ["the capital of #", "#'s capital"],
        reverse_property_projection: ["the capital of",],
        reverse_property2_projection: ['capital', 'county seat', 'first city', 'center of administration'],
    },
    'P421': {
        base: ['time zone'],
        passive_verb: ["located in # time zone"],
        preposition: ["in # time zone", "in # time"],
    },
    'P190': {
        base: ['sister city', 'sister town', 'twin town', 'partner town'],
        base_projection: ['administrative territory', 'administrative territories'],
        property: ['sister city', 'sister town', 'twin town', 'partner town'],
        property_projection: ['sister city', 'sister town', 'twin town', 'partner town']
    },
    'P194': {
        base: ['legislative body'],
        base_projection: ['legislature', 'assembly'],
        property: ["representative body", "legislative body"],
        property_projection: ["representative body", "legislative body"],
        reverse_verb_projection: ["represents", "governs"]
    },
    'P17': {
        base: ['country'],
        base_projection: ['administrative territory', 'administrative territories', 'political territory', 'political territories'],
        preposition: ["in #"],
        preposition_projection: ["in"],
        reverse_property: ["a part of #"],
        reverse_property_projection: ["a part of"],
        verb: ["belong to"],
        verb_projection: ["belong to"],
        passive_verb: ["situated in #", "located in", "present in"],
        passive_verb_projection: ["situated in", "located in", "present in"]
    },
    'P6': {
        base: ['head of government'],
        base_projection: ['people'],
        property: ["head of government", "heads of government", "leader #"],
        property_projection: ["head of government", "heads of government"],
        verb_projection: ["have their government headed by"],
    },
    'P206': {
        base_projection: ['watercourse'],
        preposition: ["next to #"],
        preposition_projection: ["next to"],
        verb: ["borders #"],
        verb_projection: ["borders #"],
        passive_verb: ["located next to #", "situated near by", "situated close to", "situated in the neighbourhood of"],
        passive_verb_projection: ["located next to", "situated near by", "situated close to", "situated in the neighbourhood of"]
    },
    'P163': {
        base: ["name of flag", 'flag'],
        base_projection: ["name of flag", 'flag'],
        passive_verb: ["associated with"],
        passive_verb_projection: ["associated with"],
    },
    'P237': {
        base: ["coat of arms", 'ensign'],
        base_projection: ["coat of arms"], 
        reverse_verb_projection: ["serves as the ensign for", "serves as the heraldic design for"], 
    },
    'P47': {
        base_projection: ['french administrative divisions', 'administrative territory', 'administrative territories', 'political territory', 'political territories', 'cities', ],
        verb: ["shares border with #", "borders #"],
        reverse_verb_projection: ['shares the border with', 'have a shared border with'],
        preposition: ["next to #", "adjacent to"],
        preposition_projection: ["next to", "adjacent to"],
        passive_verb: ["located next to #", "bordered by"],
        passive_verb_projection: ["located next to", "bordered by"]
    },
    'P112': {
        base: ['founder'],
        base_projection: ['founder'],
        projection_pronoun: ['who'],
        property: ['founder'],
        property_projection: ['founder'],
        reverse_verb_projection: ['founded'],
        passive_verb: ["founded by #"],
        passive_verb_projection: ["founded by"]
    },
    'P361': {
        base_projection: ['city', 'county of iran'],
        reverse_property: ["a part of #", 'a component of #'],
        reverse_property_projection: ["a part of", 'a component of'],
    },
    'P1313': {
        base: ['office held by head of government'],
        base_projection: ['occupation'],
        passive_verb: ["lead by #", "governed by #", "run by #", 'held by'],
        passive_verb_projection: ["lead by", "governed by", "run by", 'held by', 'fulfilled by'],
        reverse_verb_projection: ['serves as the political office that is fulfilled by the head of government of']
    },
    'P37': {
        base: ['official language'],
        base_projection: ['language'],
        verb: ['designates # as its official language'],
        property: ["official language"],
        property_projection: ['official language'],
    },
    'P417': {
        base: ["patron saint"],
        projection_pronoun: ['who'],
        property_projection: ["patron saint"],
    },
    'P1383': {
        base_projection: ['administrative territory', 'administrative territories'],
        verb: ['have administrative control over #', 'supervises'],
        verb_projection: ['have administrative control over', 'supervises'],
        passive_verb: ['administratively managed by #'],
        passive_verb_projection: ['administratively managed by'],
        preposition: ['belong to', 'in'],
        preposition_projection: ['belong to', 'in'],
    },
    'P166': {
        base: ['award'],
        base_projection: ['award', 'order'],
        property: ['# award'],
        reverse_passive_verb_projection: ['won by', "awarded with", "awarded to", "received by"]
    },
    'P706': {
        base_projection: ["plain", "landscape", "location", "natural region"],
        passive_verb: ["located on #"],
        passive_verb_projection: ["located on"],
        preposition: ["on #", "on a #"]
    },
    'P1435': {
        base: ['heritage status'],
        base_projection: ['cultural property'],
        reverse_verb_projection: ['gives the heritage status of']
    },
    'P30': {
        projection_pronoun: ['where'],
        base: ['continent'],
        base_projection: ['continent', 'geographic location'],
        reverse_property: ["a part of #"],
        reverse_property_projection: ["a part of"],
        passive_verb: ['situated in', 'located in'],
        passive_verb_projection: ['situated in', 'located in'],
        preposition: ["in #", "within #"],
        preposition_projection: ["in", "within"]
    },
    'P138': {
        base: ["namesake", 'etymology'],
        base_projection: ['person', 'architectural structure', 'social group', 'watercourse'],
        passive_verb: ["named after #"],
        passive_verb_projection: ["named after"],
        reverse_property: ['the origin of'],
        reverse_property_projection: ['the origin of'],
        property: ["namesake", 'etymology'],
        property_projection: ["namesake", 'etymology']
    },
    'P1080': {
        preposition: ["from #", "from the fictional universe #"]
    },
    'P610': {
        base: ['highest point', 'zenith'],
        base_projection: ['concept', 'terrain'],
        property: ['highest point', 'zenith'],
        property_projection: ['highest point', 'zenith'],
    },
    'P463': {
        reverse_property: ["member of"],
        passive_verb: ["participated in"],
    },
    'P36': {
        base: ["capital"],
        base_projection: ['city'],
        property: ["capital"],
        property_projection: ["capital"],
    },
    'P159': {
        projection_pronoun: ['where'],
        base: ["headquarters", "head office", "main office"],
        base_projection: ['thoroughfare'],
        property: ["headquarters", "head office", "main office"],
        property_projection: ["headquarters", "head office", "main office"],
    },
    'P793': {
        base: ['significant event'],
        base_projection: ['event', 'significant event'],
        passive_verb: ['associated with'],
        passive_verb_projection: ['associated with'],
    },
    'P748': {
        preposition: ['appointed by']
    }
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
