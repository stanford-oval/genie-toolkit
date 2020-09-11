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
"use strict";
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const PROPERTY_TYPE_OVERRIDE = {
    'P166': Type.Array(Type.Entity('org.wikidata:award')), // award_received
    'P106': Type.Array(Type.Entity('org.wikidata:occupation')), // occupation
    'P26': Type.Entity('org.wikidata:human'), // spouse (it misses no "value type constraint" property)
    'P21': Type.Enum(['female', 'male']),
    'P17': Type.Entity('org.wikidata:country'), // country
    'P2295': Type.Currency, // net profit (it misses no allowed unit property)
};

// properties that should have the same type as the subject
const PROPERTY_TYPE_SAME_AS_SUBJECT = new Set([
    'P190', // twinned_administrative_body
    'P47' // shares_border_with
]);

const PROPERTY_FORCE_ARRAY = new Set([
    'P1449', // nickname
    'P206', // located_in_or_next_to_body_of_water
    'P190', // twinned_administrative_body
    'P47', // shares_border_with
    'P112', // founded_by
    'P488', // chair person
    'P2828', // corporate_officer
    'P452', // industry,
    'P1056', // product_or_material_produced
]);

const PROPERTY_FORCE_NOT_ARRAY = new Set([

]);


const MANUAL_PROPERTY_CANONICAL_OVERRIDE = {

};

const MANUAL_TABLE_CANONICAL_OVERRIDE = {

};

const PROPERTIES_NO_FILTER = [

];

const STRING_FILE_OVERRIDES = {
};


module.exports = {
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE,

    PROPERTY_TYPE_OVERRIDE,
    PROPERTIES_NO_FILTER,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_TYPE_SAME_AS_SUBJECT,

    STRING_FILE_OVERRIDES
};
