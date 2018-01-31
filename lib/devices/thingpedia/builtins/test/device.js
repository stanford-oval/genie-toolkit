// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const crypto = require('crypto');
const Tp = require('thingpedia');

function genFakeData(size, fill) {
    return String(Buffer.alloc(size, fill));
}

class NewData extends Tp.BaseChannel {
    constructor(engine, device, params) {
        super(engine, device, params);
        this.interval = params[0];
        this.size = params[1];
        this._count = 0;

        this.filterString = this.interval + '-' + this.size;
    }

    _onTick() {
        console.log(`Triggering ${this.size} bytes of data`);
        this.emitEvent([this.interval, this.size, genFakeData(this.size, '!'.charCodeAt(0) + this._count)]);
        this._count++;
    }
}

class GetData extends Tp.BaseChannel {
    invokeQuery(filters) {
        let size = filters[0];
        let count = filters[1] || 1;
        if (count <= 0)
            count = 1;
        console.log(`Generating ${size} bytes of fake data, ${count} times`);

        let ret = [];
        for (let i = 0; i < count; i++)
            ret.push([size, count, genFakeData(size, '!'.charCodeAt(0) + i)]);
        return ret;
    }
}

class EatData extends Tp.BaseChannel {
    sendEvent(event) {
        let data = event[0];
        console.log(`Ate data`, data);
    }
}

module.exports = class TestDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);
        this.uniqueId = 'org.thingpedia.builtin.test';
        this.name = "Test Device";
        this.description = "Test Device, does nothing but generate fake data";
        this.isTransient = true;
    }

    getTriggerClass(id) {
        switch (id) {
        case 'new_data':
            return NewData;
        default:
            throw new Error('Invalid channel ID ' + id);
        }
    }

    getQueryClass(id) {
        switch (id) {
        case 'get_data':
            return GetData;
        default:
            throw new Error('Invalid channel ID ' + id);
        }
    }

    getActionClass(id) {
        switch (id) {
        case 'eat_data':
            return EatData;
        default:
            throw new Error('Invalid channel ID ' + id);
        }
    }
}
