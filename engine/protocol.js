// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ValueProto = {
    makeString: function(value) {
        if (value.isBoolean)
            return 'bool:' + value.value;
        else if (value.isString)
            return 'str:' + value.value;
        else if (value.isMeasure)
            return 'measure:' + value.unit + ':' + value.value;
        else if (value.isNumber)
            return 'number:' + value.value;
        else if (value.isLocation)
            return 'loc:' + value.x + ',' + value.x;
        else if (value.isDate)
            return 'date:' + value.value.getTime();
        else if (value.isArray)
            return 'array:[' + value.value.map(ValueProto.makeString).join(',') + ']';
        else
            throw new TypeError();
    },

    marshal: function(value) {
        if (value.isBoolean)
            return { tag: 'bool', v: value.value };
        else if (value.isString)
            return { tag: 'str', v: value.value };
        else if (value.isMeasure)
            return { tag: 'measure', v: value.value, u: value.unit };
        else if (value.isNumber)
            return { tag: 'number', v: value.value };
        else if (value.isLocation)
            return { tag: 'loc', x: value.x, y: value.y };
        else if (value.isDate)
            return { tag: 'date', v: value.value.getTime() };
        else if (value.isArray)
            return { tag: 'array', v: value.value.map(ValueProto.marshal) };
        else if (value.isFeed)
            return { tag: 'feed', v: value.value.feedId };
        else
            throw new TypeError();
    },

    unmarshal: function(messaging, value) {
        switch(value.tag) {
        case 'bool':
            return Ast.Value.Boolean(value.v);
        case 'str':
            return Ast.Value.String(value.v);
        case 'measure':
            return Ast.Value.Measure(value.v, value.u);
        case 'number':
            return Ast.Value.Number(value.v);
        case 'loc':
            return Ast.Value.Location(value.x, value.y);
        case 'date':
            var date = new Date;
            date.setTime(value.v);
            return Ast.Value.Date(date);
        case 'array':
            return Ast.Value.Array(value.v.map(function(v) {
                return ValueProto.unmarshal(messaging, v);
            }));
        case 'feed':
            return Ast.Value.Feed(messaging.getFeed(value.v));
        default:
            throw new TypeError();
        }
    }
};

const ParamsProto = {
    makeString: function(params) {
        return params.map(function(p) {
            return ValueProto.makeString(p);
        }).join('---');
    },

    marshal: function(params) {
        return params.map(function(p) {
            return ValueProto.marshal(p);
        });
    },

    unmarshal: function(messaging, params) {
        return params.map(function(p) {
            return ValueProto.unmarshal(messaging, p);
        });
    }
};

module.exports = {
    values: ValueProto,
    params: ParamsProto,
};
