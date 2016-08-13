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
            return '[' + value.map(makeString).join(',') + ']';
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
            return value.map(marshal);
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
            return value.map((v) => unmarshal(messaging, v));
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
    makeString: function(params) {
        if (params === undefined)
            return '';
        return params.map(function(p) {
            return ValueProto.makeString(p);
        }).join('-');
    },

    marshal: function(params) {
        if (params === undefined)
            return undefined;
        return params.map(function(p) {
            return ValueProto.marshal(p);
        });
    },

    unmarshal: function(messaging, params) {
        if (params === undefined)
            return undefined;
        return params.map(function(p) {
            return ValueProto.unmarshal(messaging, p);
        });
    }
};

module.exports = {
    values: ValueProto,
    params: ParamsProto,
};
