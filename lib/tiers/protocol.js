// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');

const Tp = require('thingpedia');
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
        else if (value instanceof Tp.Messaging.Feed)
            return value.feedId;
        else
            return String(value);
    },

    marshal(value) {
        if (value === null || value === undefined)
            return null;
        if (value instanceof Array)
            return value.map(ValueProto.marshal);
        else if (value instanceof Date)
            return { tag: 'date', v: value.getTime() };
        else if (value instanceof Tp.Messaging.Feed)
            return { tag: 'feed', v: value.feedId };
        else
            return value;
    },

    unmarshal(messaging, value) {
        if (value === null || value === undefined)
            return undefined;
        if (value instanceof Array) {
            return value.map((v) => ValueProto.unmarshal(messaging, v));
        } else if (value.tag === 'date') {
            var d = new Date;
            d.setTime(value.v);
            return d;
        } else if (value.tag === 'feed') {
            return messaging.getFeed(value.v);
        } else {
            return value;
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

    unmarshal(messaging, params) {
        if (params === undefined)
            return undefined;
        if (params === null)
            return null;
        return params.map(function(p) {
            return ValueProto.unmarshal(messaging, p);
        });
    }
};

const SelectorProto = {
    marshal(selector) {
        if (selector.isBuiltin)
            return {tag:'builtin'};
        if (selector.isDevice && selector.id === null && selector.principal === null)
            return {tag:'global', kind:selector.kind};
        if (selector.isDevice)
            return {tag:'device', kind:selector.kind, id:selector.id, principal:selector.principal};
        return null;
    },

    unmarshal(messaging, obj) {
        switch (obj.tag) {
        case 'builtin':
            return Ast.Selector.Builtin;
        case 'device':
            return Ast.Selector.Device(obj.kind, obj.id, obj.principal);
        case 'global':
            return Ast.Selector.Device(obj.kind, null, null);
        default:
            throw new Error('Invalid selector tag ' + obj.tag);
        }
    }
}

module.exports = {
    values: ValueProto,
    params: ParamsProto,
    selector: SelectorProto,
};
