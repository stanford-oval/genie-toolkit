// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const AppCompiler = require('./app_compiler');

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
        else if (value.isObject)
            return 'obj:' + value.value.uniqueId;
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
        else if (value.isObject)
            return { tag: 'obj', v: value.value.uniqueId };
        else if (value.isArray)
            return { tag: 'array', v: value.value.map(ValueProto.marshal) };
        else
            throw new TypeError();
    },

    unmarshal: function(devices, value) {
        switch(value.tag) {
        case 'bool':
            return AppCompiler.Value.Boolean(value.v);
        case 'str':
            return AppCompiler.Value.String(value.v);
        case 'measure':
            return AppCompiler.Value.Measure(value.v, value.u);
        case 'number':
            return AppCompiler.Value.Number(value.v);
        case 'loc':
            return AppCompiler.Value.Location(value.x, value.y);
        case 'date':
            var date = new Date;
            date.setTime(value.v);
            return AppCompiler.Value.Date(date);
        case 'obj':
            return AppCompiler.Value.Object(devices.getDevice(value.v));
        case 'array':
            return AppCompiler.Value.Array(value.v.map(ValueProto.unmarshal.bind(null, devices)));
        default:
            throw new TypeError();
        }
    }
};

const FilterProto = {
    makeString: function(filters) {
        return filters.map(function(filter) {
            if (filter.isThreshold) {
                var lhs = filter.lhs;
                var comp = filter.comp;
                var rhs = filter.rhs;
                if (!rhs.isConstant)
                    throw new TypeError();
                if (lhs.isVarRef)
                    return 'var:' + lhs.name + comp + ValueProto.makeString(rhs.value);
                else if (!lhs.isConstant)
                    throw new TypeError();
                return ValueProto.makeString(lhs.value) + comp + ValueProto.makeString(rhs.value);
            } else {
                throw new TypeError();
            }
        }).join('---');
    },

    marshal: function(filters) {
        return filters.map(function(filter) {
            if (filter.isThreshold) {
                var lhs = filter.lhs;
                var comp = filter.comp;
                var rhs = filter.rhs;
                if (!rhs.isConstant)
                    throw new TypeError();
                if (lhs.isVarRef)
                    return { tag: 'threshold', lhs: { tag: 'var', v: lhs.name}, comp: comp, rhs: ValueProto.marhsal(rhs.value) };
                else if (!lhs.isConstant)
                    throw new TypeError();
                return { tag: 'threshold', lhs: ValueProto.marshal(lhs.value), comp: comp, rhs: ValueProto.marshal(rhs.value) };
            } else {
                throw new TypeError();
            }
        });
    },

    unmarshal: function(devices, filters) {
        return filters.map(function(filter) {
            switch(filter.tag) {
            case 'threshold:':
                if (filter.lhs.tag === 'var')
                    return AppCompiler.InputRule.Threshold(AppCompiler.Expression.VarRef(filter.lhs.v),
                                                           filter.comp,
                                                           AppCompiler.Expression.Constant(ValueProto.unmarshal(devices, filter.rhs)));
                else
                    return AppCompiler.InputRule.Threshold(AppCompiler.Expression.Constant(ValueProto.unmarshal(devices, filter.lhs)),
                                                           filter.comp,
                                                           AppCompiler.Expression.Constant(ValueProto.unmarshal(devices, filter.rhs)));
            default:
                throw new TypeError();
            }
        });
    }
};

const SelectorProto = {
    makeString: function(selectors) {
        return selectors.map(function(simple) {
            if (simple.isId)
                return 'id:' + simple.name;
            else if (simple.isTags)
                return 'tags:' + simple.tags.join(',');
            else if (simple.isKind)
                return 'kind:' + simple.kind;
            else if (simple.isAny)
                return 'any';
            else
                throw new TypeError();
        }).join('--');
    },

    marshal: function(selectors) {
        return selectors.map(function(simple) {
            if (simple.isId)
                return { tag: 'id', name: simple.name };
            else if (simple.isTags)
                return { tag: 'tags', tags: simple.tags };
            else if (simple.isKind)
                return { tag: 'kind', name: simple.name };
            else if (simple.isAny)
                return { tag: 'any' };
            else
                throw new TypeError();
        });
    },

    unmarshal: function(devices, selectors) {
        return selectors.map(function(simple) {
            switch(simple.tag) {
            case 'id':
                return AppCompiler.Selector.Id(simple.name);
            case 'tags':
                return AppCompiler.Selector.Tags(simple.tags);
            case 'kind':
                return AppCompiler.Selector.Kind(simple.name);
            case 'any':
                return AppCompiler.Selector.Any;
            default:
                throw new TypeError();
            }
        });
    },
};

module.exports = {
    selectors: SelectorProto,
    values: ValueProto,
    filters: FilterProto,
};
