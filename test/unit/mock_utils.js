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


import * as Tp from 'thingpedia';

class MockPreferences {
    constructor() {
        this._store = {};

        // change this line to test the initialization dialog
        this._store['sabrina-initialized'] = true;
        this._store['sabrina-name'] = "Alice Tester";
    }

    get(name) {
        return this._store[name];
    }

    set(name, value) {
        console.log(`preferences set ${name} = ${value}`);
        this._store[name] = value;
    }
}

class MockPlatform extends Tp.BasePlatform {
    constructor() {
        super();

        this._prefs = new MockPreferences();
    }

    getSharedPreferences() {
        return this._prefs;
    }
    getDeveloperKey() {
        return null;
    }

    get locale() {
        return 'en-US';
    }
    get timezone() {
        return 'America/Los_Angeles';
    }
    get type() {
        return 'test';
    }

    getCacheDir() {
        return './cache';
    }

    getWritableDir() {
        return './';
    }
}

export {
    MockPlatform
};
