// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const PollingStream = Tp.Helpers.PollingStream;

function genFakeData(size, fill) {
    return String(Buffer.alloc(size, fill));
}

module.exports = class TestDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);
        this.uniqueId = 'org.thingpedia.builtin.test';
        this.name = "Test Device";
        this.description = "Test Device, does nothing but generate fake data";
        this.isTransient = true;
    }

    get_get_data(args) {
        let size = args.size;
        let count = args.count;
        if (count <= 0)
            count = 1;
        console.log(`Generating ${size} bytes of fake data, ${count} times`);

        let ret = [];
        for (let i = 0; i < count; i++)
            ret.push({ data: genFakeData(size, '!'.charCodeAt(0) + i) });
        return ret;
    }
    subscribe_get_data(args, state) {
        let count = 0;
        return new PollingStream(state, 10000, () => {
            console.log(`Triggering ${args.size} bytes of data`);
            return [{ data: genFakeData(args.size, '!'.charCodeAt(0) + (count++)) }];
        });
    }
    do_eat_data(args) {
        console.log(`Ate data`, args.data);
    }
};
