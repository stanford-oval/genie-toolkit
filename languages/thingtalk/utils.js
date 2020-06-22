// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2015-2020 The Board of Trustees of the Leland Stanford Junior University
//           2019 National Taiwan University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//         Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

function typeToStringSafe(type) {
    if (type.isArray)
        return 'Array__' + typeToStringSafe(type.elem);
    else if (type.isEntity)
        return 'Entity__' + type.type.replace(':', '__');
    else if (type.isMeasure)
        return 'Measure_' + type.unit;
    else if (type.isEnum)
        return 'Enum__' + type.entries.join('__');
    else
        return String(type);
}

function clean(name) {
    if (/^[vwgp]_/.test(name))
        name = name.substr(2);
    return name.replace(/_/g, ' ').replace(/([^A-Z ])([A-Z])/g, '$1 $2').toLowerCase();
}


function makeFilter(loader, pname, op, value, negate = false) {
    assert(pname instanceof Ast.Value.VarRef);
    let vtype = value.getType();
    let ptype = vtype;
    if (ptype.isEntity && ptype.type === 'tt:url')
        return null;
    if (op === 'contains') {
        ptype = Type.Array(vtype);
        if (vtype.isString)
            op = 'contains~';
    } else if (op === '==' && vtype.isString) {
        op = '=~';
    }
    if (!loader.params.out.has(pname.name + '+' + ptype))
        return null;
    if (loader.flags.turking && value.isEnum)
        return null;

    let f = new Ast.BooleanExpression.Atom(null, pname.name, op, value);
    if (negate)
        return new Ast.BooleanExpression.Not(null, f);
    else
        return f;
}

function makeAndFilter(loader, param, op, values, negate=false) {
    if (values.length !== 2)
        return null;
    if (values[0].name === values[1].name)
        return null;
    const operands  = values.map((v) => makeFilter(loader, param, op, v));
    if (operands.includes(null))
        return null;
    const f = new Ast.BooleanExpression.And(null, operands);
    if (negate)
        return new Ast.BooleanExpression.Not(null, f);
    return f;
}

function isHumanEntity(type) {
    if (type.isEntity)
        return isHumanEntity(type.type);
    if (type.isArray)
        return isHumanEntity(type.elem);
    if (typeof type !== 'string')
        return false;
    if (['tt:contact', 'tt:username', 'org.wikidata:human'].includes(type))
        return true;
    if (type.startsWith('org.schema') && type.endsWith(':Person'))
        return true;
    return false;
}

module.exports = {
    clean,

    isUnaryTableToTableOp(table) {
        return table.isFilter ||
            table.isProjection ||
            table.isCompute ||
            table.isAlias ||
            table.isSort ||
            table.isIndex ||
            table.isSlice ||
            table.isAggregation ||
            table.isSequence ||
            table.isHistory;
    },
    isUnaryStreamToTableOp(table) {
        return table.isWindow || table.isTimeSeries;
    },
    isUnaryStreamToStreamOp(stream) {
        return stream.isEdgeNew ||
            stream.isEdgeFilter ||
            stream.isFilter ||
            stream.isProjection ||
            stream.isCompute ||
            stream.isAlias;
    },
    isUnaryTableToStreamOp(stream) {
        return stream.isMonitor;
    },

    typeToStringSafe,
    makeFilter,
    makeAndFilter,

    isHumanEntity
};
