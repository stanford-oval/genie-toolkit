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

const ThingTalk = require('thingtalk');

const ValueProto = {
    makeString(value) {
        if (value === null || value === undefined)
            return '';
        if (value instanceof Array)
            return '[' + value.map(ValueProto.makeString).join(',') + ']';
        else if (value instanceof Date)
            return String(value.getTime());
        else
            return String(value);
    },

    marshal(value) {
        if (value === null || value === undefined)
            return null;
        if (value instanceof Array)
            return value.map(ValueProto.marshal);
        else if (value instanceof ThingTalk.Builtin.Entity)
            return { tag: 'entity', v: value.value, d: value.display };
        else if (value instanceof ThingTalk.Builtin.Currency)
            return { tag: 'currency', v: value.value, c: value.code };
        else if (value instanceof ThingTalk.Builtin.Location)
            return { tag: 'loc', x: value.x, y: value.y, d: value.display };
        else if (value instanceof ThingTalk.Builtin.Time)
            return { tag: 'time', h: value.hour, m: value.minute, s: value.second };
        else if (value instanceof Date)
            return { tag: 'date', v: value.getTime() };
        else
            return value;
    },

    unmarshal(value) {
        if (value === null || value === undefined)
            return null;
        if (value instanceof Array) {
            return value.map(ValueProto.unmarshal);
        } else {
            switch (value.tag) {
            case 'date':
                return new Date(value.v);
            case 'currency':
                return new ThingTalk.Builtin.Currency(value.v, value.c);
            case 'entity':
                return new ThingTalk.Builtin.Entity(value.v, value.d);
            case 'loc':
                return new ThingTalk.Builtin.Location(value.y, value.x, value.d);
            case 'time':
                return new ThingTalk.Builtin.Time(value.h, value.m, value.s);
            default:
                return value;
            }
        }
    }
};

const ParamsProto = {
    makeString(params) {
        if (params === undefined)
            return '';
        return Object.keys(params).map((key) =>
            `${key}=${ValueProto.makeString(params[key])}`
        ).join(':');
    },

    marshal(params) {
        if (params === undefined)
            return undefined;
        if (params === null)
            return null;
        let obj = {};
        Object.keys(params).forEach((key) => {
            obj[key] = ValueProto.marshal(params[key]);
        });
        return obj;
    },

    unmarshal(params) {
        if (params === undefined)
            return undefined;
        if (params === null)
            return null;
        let obj = {};
        Object.keys(params).forEach((key) => {
            obj[key] = ValueProto.unmarshal(params[key]);
        });
        return obj;
    }
};

module.exports = {
    values: ValueProto,
    params: ParamsProto
};
