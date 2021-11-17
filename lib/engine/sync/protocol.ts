// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
    makeString(value : unknown) : string {
        if (value === null || value === undefined)
            return '';
        if (value instanceof Array)
            return '[' + value.map(ValueProto.makeString).join(',') + ']';
        else if (value instanceof Date)
            return String(value.getTime());
        else if (typeof value === 'object' && value!.toString === Object.prototype.toString)
            return ParamsProto.makeString(value as Record<string, unknown>);
        else
            return String(value);
    },

    marshal(value : unknown) : unknown {
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

    unmarshal(value : unknown) : unknown {
        if (value === null || value === undefined)
            return null;
        if (value instanceof Array) {
            return value.map(ValueProto.unmarshal);
        } else {
            const anyValue = value as any;
            switch (anyValue.tag) {
            case 'date':
                return new Date(anyValue.v);
            case 'currency':
                return new ThingTalk.Builtin.Currency(anyValue.v, anyValue.c);
            case 'entity':
                return new ThingTalk.Builtin.Entity(anyValue.v, anyValue.d);
            case 'loc':
                return new ThingTalk.Builtin.Location(anyValue.y, anyValue.x, anyValue.d);
            case 'time':
                return new ThingTalk.Builtin.Time(anyValue.h, anyValue.m, anyValue.s);
            default:
                return value;
            }
        }
    }
};

const ParamsProto = {
    makeString(params : Record<string, unknown>|undefined) {
        if (params === undefined)
            return '';
        return Object.keys(params).map((key) =>
            `${key}=${ValueProto.makeString(params[key])}`
        ).join(':');
    },

    marshal(params : Record<string, unknown>|null|undefined) : unknown {
        if (params === undefined)
            return undefined;
        if (params === null)
            return null;
        const obj : Record<string, unknown> = {};
        Object.keys(params).forEach((key) => {
            obj[key] = ValueProto.marshal(params[key]);
        });
        return obj;
    },

    unmarshal(params : Record<string, unknown>|null|undefined) : unknown {
        if (params === undefined)
            return undefined;
        if (params === null)
            return null;
        const obj : Record<string, unknown> = {};
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
