// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const fs = require('fs');
const path = require('path');
const Builtins = require('../../../lib/devices/builtins');

class TestDatabaseDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        this.isTransient = true;
        this.uniqueId = 'org.thingpedia.builtin.test.test_database';
    }

    query(query) {
        const table = query.rules[0].table;
        if (table.isInvocation)
            return [{ foo: ':-)' }];
        if (table.isJoin)
            return [{ foo: ':-)', bar: '(-:' }];
        if (table.isAggregation)
            return [{ count: 1 }];
    }
}
module.exports = TestDatabaseDevice;

const manifest = fs.readFileSync(path.resolve(path.dirname(module.filename), 'test_database.tt')).toString('utf8');
Builtins['org.thingpedia.builtin.test.test_database'] = {
    class: manifest,
    module: TestDatabaseDevice
};
