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

import * as ThingTalk from 'thingtalk';
const Type = ThingTalk.Type;

const PROPERTY_TYPE_OVERRIDE = {
    'approximate_ride_duration': new Type.Measure('ms'),
    'precipitation': Type.Number,
    'humidity': Type.Number,
    'wind': new Type.Measure('mps'),
    'temperature': new Type.Measure('C'),
    'balance': Type.Currency,
    'price_per_night': Type.Currency,
    'rent': Type.Currency,
};

const MANUAL_PROPERTY_CANONICAL_OVERRIDE = {

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

    STRING_FILE_OVERRIDES
};
