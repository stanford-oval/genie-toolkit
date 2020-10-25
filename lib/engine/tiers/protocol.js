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


import * as ThingTalk from 'thingtalk';

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

export {
    ValueProto as values,
    ParamsProto as params
};
