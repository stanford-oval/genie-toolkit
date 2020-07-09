// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2016-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

class MockPreferences {
    constructor() {
        this._store = {};

        // change this line to test the initialization dialog
        this._store['sabrina-initialized'] = true;
        this._store['sabrina-name'] = "Alice Tester";
        this._store['experimental-contextual-model'] = false;
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
}

module.exports = {
    MockPlatform
};
