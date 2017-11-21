// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

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
        else if (value instanceof ThingTalk.Entity)
            return { tag: 'entity', v: value.value, d: value.display };
        else if (value instanceof ThingTalk.Location)
            return { tag: 'loc', x: value.x, y: value.y, d: value.display };
        else if (value instanceof ThingTalk.Time)
            return { tag: 'time', h: value.hour, m: value.minute, s: value.second };
        else if (value instanceof Date)
            return { tag: 'date', v: value.getTime() };
        else
            return value;
    },

    unmarshal(value) {
        if (value === null || value === undefined)
            return undefined;
        if (value instanceof Array) {
            return value.map(ValueProto.unmarshal);
        } else {
            switch (value.tag) {
            case 'date':
                return new Date(value.v);
            case 'entity':
                return new ThingTalk.Entity(value.v, value.d);
            case 'loc':
                return new ThingTalk.Location(value.y, value.x, value.d);
            case 'time':
                return new ThingTalk.Time(value.h, value.m, value.s);
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
        return params.map(function(p) {
            return ValueProto.makeString(p);
        }).join('-');
    },

    marshal(params) {
        if (params === undefined)
            return undefined;
        if (params === null)
            return null;
        return params.map(function(p) {
            return ValueProto.marshal(p);
        });
    },

    unmarshal(params) {
        if (params === undefined)
            return undefined;
        if (params === null)
            return null;
        return params.map(function(p) {
            return ValueProto.unmarshal(p);
        });
    }
};

module.exports = {
    values: ValueProto,
    params: ParamsProto
};
