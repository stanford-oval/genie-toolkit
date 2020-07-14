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
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const { arraySubset } = require('../array_utils');
const {
    setOrAddInvocationParam,
} = require('../state_manip');


function isFilterCompatibleWithInfo(info, filter) {
    assert(filter instanceof Ast.BooleanExpression);
    if (filter.isTrue || filter.isDontCare)
        return true;
    if (filter.isFalse)
        return false;
    if (filter.isOr)
        return filter.operands.some((op) => isFilterCompatibleWithInfo(info, op));
    if (filter.isAnd)
        return filter.operands.every((op) => isFilterCompatibleWithInfo(info, op));
    if (filter.isNot)
        return !isFilterCompatibleWithInfo(info, filter.expr);

    // approximate
    if (filter.isExternal || filter.isCompute)
        return true;

    assert(filter.isAtom);
    const pname = filter.name;
    if (!info.has(pname))
        return false;

    if (!filter.value.isConstant())
        return true;

    switch (filter.operator) {
    case '==':
    case '=~':
        return filter.value.equals(info.get(pname));

    case 'contains':
    case 'contains~':
        return info.get(pname).value.some((v) => v.equals(filter.value));

    case 'in_array':
    case 'in_array~':
        return filter.value.value.some((v) => v.equals(info.get(pname)));

    case '>=':
        return info.get(pname).toJS() >= filter.value.toJS();
    case '<=':
        return info.get(pname).toJS() <= filter.value.toJS();

    default:
        // approximate
        return true;
    }
}

function isFilterCompatibleWithResult(topResult, filter) {
    if (filter.isTrue || filter.isDontCare)
        return true;
    if (filter.isFalse)
        return false;
    if (filter.isAnd)
        return filter.operands.every((op) => isFilterCompatibleWithResult(topResult, op));
    if (filter.isOr)
        return filter.operands.some((op) => isFilterCompatibleWithResult(topResult, op));
    if (filter.isNot)
        return !isFilterCompatibleWithResult(topResult, filter.expr);

    if (filter.isExternal) // approximate
        return true;

    if (filter.isCompute) // approximate
        return true;

    const values = topResult.value;

    // if the value was not returned, don't verbalize it
    if (!values[filter.name])
        return false;

    const resultValue = topResult.value[filter.name];

    if (resultValue.isEntity) {
        // approximate: all strings are made up so we don't need a true likeTest here
        if (filter.operator === '=~')
            return resultValue.display === filter.value.toJS();
        else
            return String(resultValue.toJS()) === String(filter.value.toJS());
    }

    switch (filter.operator) {
    case '==':
    case '=~':
        // approximate: all strings are made up so we don't need a true likeTest here
        return String(resultValue.toJS()) === String(filter.value.toJS());

    default:
        // approximate
        return true;
    }
}

function isInfoPhraseCompatibleWithResult(topResult, info) {
    for (let [pname, infoValue] of info) {
        const resultValue = topResult.value[pname];
        if (!resultValue)
            return false;

        if (resultValue.isArray && infoValue.isArray) {
            if (!arraySubset(infoValue.value, resultValue.value))
                return false;
        } else {
            if (!resultValue.equals(infoValue))
                return false;
        }
    }
    return true;
}

/**
 * Check if asking a question on the parameters "questions" is allowed.
 *
 * This checks two things: that all parameters are valid output parameters of the table,
 * and all parameters are filterable.
 */
function isValidSearchQuestion(table, questions) {
    for (let q of questions) {
        const arg = table.schema.getArgument(q);
        if (!arg || arg.is_input)
            return false;
        if (arg.getAnnotation('filterable') === false)
            return false;
    }
    return true;
}


function addParametersFromContext(toInvocation, fromInvocation) {
    let newParams = new Set;
    for (let in_param of toInvocation.in_params) {
        if (in_param.value.isUndefined)
            continue;
        newParams.add(in_param.name);
    }

    let cloned = false;

    for (let in_param of fromInvocation.in_params) {
        if (in_param.value.isUndefined)
            continue;
        if (newParams.has(in_param.name))
            continue;

        if (!cloned) {
            toInvocation = toInvocation.clone();
            cloned = true;
        }

        setOrAddInvocationParam(toInvocation, in_param.name, in_param.value);
    }

    return toInvocation;
}


function findChainParam(topResult, action) {
    const resultType = topResult.value.id.getType();

    let chainParam = undefined;
    for (let arg of action.schema.iterateArguments()) {
        if (arg.type.equals(resultType)) {
            chainParam = arg.name;
            break;
        }
    }
    return chainParam;
}

function isSimpleFilterTable(table) {
    return table.isFilter && ((table.table.isCompute && table.table.table.isInvocation) || table.table.isInvocation);
}

module.exports = {
    isFilterCompatibleWithInfo,
    isFilterCompatibleWithResult,
    isInfoPhraseCompatibleWithResult,
    isValidSearchQuestion,
    isSimpleFilterTable,
    findChainParam,
    addParametersFromContext
};
