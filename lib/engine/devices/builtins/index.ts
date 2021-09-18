// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as Tp from 'thingpedia';

import Test from './test';
import ThingEngine from './thingengine';
import ThingEngineBuiltin from './thingengine.builtin';

import TestTT from './org.thingpedia.builtin.test.tt.json';
import ThingEngineTT from './org.thingpedia.builtin.thingengine.tt.json';
import ThingEngineBuiltinTT from './org.thingpedia.builtin.thingengine.builtin.tt.json';
import VolumeControlTT from './org.thingpedia.volume-control.tt.json';

export const modules : Record<string, { class : string, module : Tp.BaseDevice.DeviceClass<Tp.BaseDevice> }> = {
    'org.thingpedia.builtin.test' : {
        class: TestTT,
        module: Test
    },

    'org.thingpedia.builtin.thingengine': {
        class: ThingEngineTT,
        module: ThingEngine
    },

    'org.thingpedia.builtin.thingengine.builtin': {
        class: ThingEngineBuiltinTT,
        module: ThingEngineBuiltin
    },
};

export const interfaces : Record<string, string> = {
    'org.thingpedia.volume-control': VolumeControlTT,
};
