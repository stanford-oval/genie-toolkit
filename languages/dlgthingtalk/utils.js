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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Inflectors = require('en-inflectors').Inflectors;
const Tag = require('en-pos').Tag;

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
    // param is a Value.VarRef
    //console.log('param: ' + param.name);
    let vtype = value.getType();
    let ptype = vtype;
    if (op === 'contains')
        ptype = Type.Array(vtype);
    else if (op === '==' && vtype.isString)
        op = '=~';
    if (!loader.params.out.has(pname + '+' + ptype))
        return null;
    if (loader.flags.turking && value.isEnum)
        return null;

    let f = new Ast.BooleanExpression.Atom(null, pname, op, value);
    if (negate)
        return new Ast.BooleanExpression.Not(null, f);
    else
        return f;
}

// FIXME do not duplicate this, and also this needs to be moved inside lib/i18n/
function pluralize(name) {
    if (!name.includes(' ')) {
        if (new Tag([name]).initial().tags[0] === 'NN')
            return new Inflectors(name).toPlural();
        return name;
    } else {
        const words = name.split(' ');
        const tags = new Tag(words).initial().tags;
        if (tags[tags.length - 1] !== 'NN')
            return name;
        else if (['VB', 'VBP', 'VBZ', 'VBD'].includes(tags[0]))
            return name;
        words[words.length - 1] = pluralize(words[words.length - 1]);
        return words.join(' ');
    }
}

module.exports = {
    clean,
    pluralize,

    isUnaryTableToTableOp(table) {
        return table.isFilter ||
            table.isProjection ||
            table.isCompute ||
            table.isAlias ||
            table.isSort ||
            table.isIndex ||
            table.isAggregation ||
            table.isArgMinMax ||
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
};
