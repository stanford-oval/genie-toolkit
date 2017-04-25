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
            d.setTime(value.value);
            return d;
        } else if (value.tag === 'feed') {
            return messaging.getFeed(value.feedId);
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
        return params.map(function(p) {
            return ValueProto.marshal(p);
        });
    },

    unmarshal(messaging, params) {
        if (params === undefined)
            return undefined;
        return params.map(function(p) {
            return ValueProto.unmarshal(messaging, p);
        });
    }
};

const SelectorProto = {
    marshal(selector) {
        if (selector.isBuiltin)
            return {tag:'builtin'};
        if (selector.isGlobalName)
            return {tag:'global', kind:selector.name};
        if (selector.isAttributes)
            return {tag:'attributes',
                attributes: selector.attributes.map((attr) => {
                    return { name: attr.name, value: attr.value };
                })
            };
        return null;
    },

    unmarshal(messaging, obj) {
        switch (obj.tag) {
        case 'builtin':
            return Ast.Selector.Builtin;
        case 'global':
            return Ast.Selector.GlobalName(obj.kind);
        case 'attributes':
            return Ast.Selector.Attributes(obj.attributes.map((attr) => {
                return Ast.Attribute(attr.name, attr.value);
            }));
        }
    }
}

module.exports = {
    values: ValueProto,
    params: ParamsProto,
    selector: SelectorProto,
};
