// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = class TestPlatformDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        this.isTransient = true;
        this.uniqueId = 'org.thingpedia.builtin.thingengine.test_platform';
    }

    get_foo() {
        return [{ lol: 'yes' }];
    }
};
