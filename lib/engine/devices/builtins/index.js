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

exports['org.thingpedia.builtin.bluetooth.generic'] = {
    class: require('./bluetooth.generic.tt.json'),
    module: require('./bluetooth.generic'),
};
exports['org.thingpedia.builtin.test'] = {
    class: require('./test.tt.json'),
    module: require('./test')
};
exports['org.thingpedia.builtin.thingengine'] = {
    class: require('./thingengine.tt.json'),
    module: require('./thingengine')
};
exports['org.thingpedia.builtin.thingengine.builtin'] = {
    class: require('./thingengine.builtin.tt.json'),
    module: require('./thingengine.builtin')
};
