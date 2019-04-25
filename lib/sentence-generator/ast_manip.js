// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const { isUnaryTableToTableOp,
        isUnaryStreamToTableOp,
        isUnaryStreamToStreamOp,
        isUnaryTableToStreamOp } = require('../utils');
const { notifyAction } = ThingTalk.Generate;

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

function findFunctionNameTable(table) {
    if (table.isInvocation)
        return [table.invocation.selector.kind + ':' + table.invocation.channel];

    if (isUnaryTableToTableOp(table))
        return findFunctionNameTable(table.table);

    if (isUnaryStreamToTableOp(table))
        return findFunctionNameStream(table.stream);

    if (table.isJoin)
        return findFunctionNameTable(table.lhs).concat(findFunctionNameTable(table.rhs));

    throw new TypeError();
}

function findFunctionNameStream(stream) {
    if (stream.isTimer || stream.isAtTimer)
        return [];

    if (isUnaryStreamToStreamOp(stream))
        return findFunctionNameStream(stream.stream);

    if (isUnaryTableToStreamOp(stream))
        return findFunctionNameTable(stream.table);

    if (stream.isJoin)
        return findFunctionNameStream(stream.stream).concat(findFunctionNameTable(stream.table));

    throw new TypeError('??? ' + stream);
}

function isSelfJoinStream(stream) {
    let functions = findFunctionNameStream(stream);
    if (functions.length > 1) {
        if (!Array.isArray(functions))
            throw new TypeError('??? ' + functions);
        functions.sort();
        for (let i = 0; i < functions.length-1; i++) {
            if (functions[i] === functions[i+1])
                return true;
        }
    }
    return false;
}

function checkNotSelfJoinStream(stream) {
    if (isSelfJoinStream(stream))
        return null;
    return stream;
}

function removeInputParameter(schema, pname) {
    return schema.removeArgument(pname);
}

function betaReduceInvocation(invocation, pname, value) {
    //console.log(`betaReduceInvocation ${pname} -> ${value}`);
    let clone = invocation.clone();
    for (let inParam of clone.in_params) {
        if (inParam.value.isVarRef && inParam.value.name === pname) {
            inParam.value = value;
            assert(clone.schema.inReq[inParam.name] || clone.schema.inOpt[inParam.name]);
            return [clone, inParam.name];
        }
    }
    //clone.in_params.push(new Ast.InputParam(pname, value));
    return [invocation, null];
}

function betaReduceAction(action, pname, value) {
    let [cloneInvocation, replaced] = betaReduceInvocation(action.invocation, pname, value);
    if (!cloneInvocation || !replaced)
        return null;
    const clone = Ast.Action.Invocation(cloneInvocation, action.schema);
    if (replaced !== pname)
        clone.schema = removeInputParameter(action.schema, pname);
    return clone;
}

function betaReduceFilter(filter, pname, value) {
    return (function recursiveHelper(expr) {
        if (expr.isTrue || expr.isFalse)
            return expr;
        if (expr.isAnd)
            return Ast.BooleanExpression.And(expr.operands.map(recursiveHelper));
        if (expr.isOr)
            return Ast.BooleanExpression.Or(expr.operands.map(recursiveHelper));
        if (expr.isNot)
            return Ast.BooleanExpression.Not(recursiveHelper(expr.expr));
        if (expr.isExternal)
            return betaReduceInvocation(expr, pname, value);

        if (expr.value.isVarRef && expr.value.name === pname) {
            let clone = expr.clone();
            clone.value = value;
            return clone;
        } else {
            return expr;
        }
    })(filter);
}

function betaReduceTable(table, pname, value) {
    if (table.isInvocation) {
        let [reduced, replaced] = betaReduceInvocation(table.invocation, pname, value);
        return new Ast.Table.Invocation(reduced, replaced && replaced !== pname ? removeInputParameter(table.schema, pname) : table.schema);
    } else if (table.isFilter) {
        let reduced = betaReduceTable(table.table, pname, value);
        return new Ast.Table.Filter(reduced, betaReduceFilter(table.filter, pname, value), removeInputParameter(table.schema, pname));
    } else if (table.isProjection) {
        return new Ast.Table.Projection(betaReduceTable(table.table, pname, value),
            table.args, removeInputParameter(table.schema, pname));
    }

    throw new Error('NOT IMPLEMENTED: ' + table);
}

function betaReduceStream(stream, pname, value) {
    if (stream.isTimer || stream.isAtTimer)
        throw new TypeError('Nothing to beta-reduce in a timer');
    if (stream.isMonitor) {
        let reduced = betaReduceTable(stream.table, pname, value);
        return new Ast.Stream.Monitor(reduced, stream.args, removeInputParameter(stream.schema, pname));
    }
    if (stream.isEdgeFilter) {
        let reduced = betaReduceStream(stream.stream, pname, value);
        return new Ast.Stream.EdgeFilter(reduced, betaReduceFilter(stream.filter, pname, value), removeInputParameter(stream.schema, pname));
    }

    throw new Error('NOT IMPLEMENTED: ' + stream);
}

function unassignInputParameter(schema, passign, pname) {
    let arg = schema.getArgument(passign).clone();
    arg.name = pname;
    return schema.addArguments([arg]);
}

// perform eta reduction
// (turn (\(x) -> f(x)) into just f
function etaReduceInvocation(invocation, pname) {
    let clone = new Ast.Invocation(invocation.selector, invocation.channel,
        Array.from(invocation.in_params), null);
    let passign;
    for (let i = 0; i < clone.in_params.length; i++) {
        let inParam = clone.in_params[i];
        if (inParam.value.isVarRef && inParam.value.name === pname) {
            passign = inParam.name;
            clone.in_params.splice(i, 1);
            break;
        }
    }
    if (!passign)
        return [undefined, clone];
    clone.schema = unassignInputParameter(invocation.schema, passign, pname);

    return [passign, clone];
}

function etaReduceTable(table, pname) {
    if (!table.schema.hasArgument(pname) || !table.schema.isArgInput(pname))
        return [undefined, table];
    if (table.isInvocation) {
        let [passign, clone] = etaReduceInvocation(table.invocation, pname);
        return [passign, new Ast.Table.Invocation(clone, clone.schema)];
    } else if (table.isFilter) {
        let [passign, clone] = etaReduceTable(table.table, pname);
        return [passign, new Ast.Table.Filter(clone, table.filter, clone.schema)];
    } else {
        // TODO
        return [undefined, table];
    }
}

function makeFilter($options, param, op, value, negate = false) {
    // param is a Value.VarRef
    //console.log('param: ' + param.name);
    let vtype = value.getType();
    if (op === 'contains')
        vtype = Type.Array(vtype);
    if (!$options.params.out.has(param.name + '+' + vtype))
        return null;

    let f = new Ast.BooleanExpression.Atom(param.name, op, value);
    if (negate)
        return new Ast.BooleanExpression.Not(f);
    else
        return f;
}

function makeEdgeFilterStream(proj, op, value, $options) {
    if (proj.table.isAggregation)
        return null;

    let f = new Ast.BooleanExpression.Atom(proj.args[0], op, value);
    if (!checkFilter(proj.table, f))
        return null;
    if (!proj.schema.is_monitorable || proj.schema.is_list)
        return null;
    let outParams = Object.keys(proj.table.schema.out);
    if (outParams.length === 1 && $options.flags.turking)
        return null;

    return new Ast.Stream.EdgeFilter(new Ast.Stream.Monitor(proj.table, null, proj.table.schema), f, proj.table.schema);
}

function addUnit(unit, num) {
    if (num.isVarRef) {
        let v = new Ast.Value.VarRef(num.name + '__' + unit);
        v.getType = () => Type.Measure(unit);
        return v;
    } else {
        return new Ast.Value.Measure(num.value, unit);
    }
}

function makeProgram(rule, principal = null) {
    return new Ast.Program([], [], [rule], principal);
}

function combineStreamCommand(stream, command) {
    if (command.table) {
        stream = new Ast.Stream.Join(stream, command.table, [], command.table.schema);
        if (isSelfJoinStream(stream))
            return null;
        return new Ast.Statement.Rule(stream, command.actions);
    } else {
        return new Ast.Statement.Rule(stream, command.actions);
    }
}

function checkFilter(table, filter) {
    if (filter.isNot)
        filter = filter.expr;
    if (filter.isExternal)
        return true;

    if (!table.schema.out[filter.name])
        return false;

    let ptype = table.schema.out[filter.name];
    let vtype = ptype;
    if (filter.operator === 'contains') {
        if (!vtype.isArray)
            return false;
        vtype = ptype.elem;
    } else if (filter.operator === 'in_array') {
        vtype = Type.Array(ptype);
    }
    if (!filter.value.getType().equals(vtype))
        return false;

    return true;
}

function addFilter(table, filter, $options) {
    if (table.isProjection)
        return new Ast.Table.Projection(addFilter(table.table, filter), table.args, table.schema);
    if (table.isFilter && $options.flags.turking)
        return null;

    if (table.isFilter) {
        // if we already have a filter, don't add a new complex filter
        if (!filter.isAtom && !(filter.isNot && filter.expr.isAtom))
             return null;

        let existing = table.filter;
        let atom = filter.isNot ? filter.expr : filter;
        // check that we don't create a non-sensical filter, eg.
        // p == X && p == Y, or p > X && p > Y
        let operands = existing.isAnd ? existing.operands : [existing];
        for (let operand of operands) {
            if (operand.isAtom && operand.name === atom.name &&
                (operand.operator === atom.operator ||
                 operand.operator === '==' ||
                 atom.operator === '==' ||
                 operand.operator === 'in_array' ||
                 atom.operator === 'in_array'))
                return null;
        }

        let newFilter = Ast.BooleanExpression.And([existing, filter]).optimize();
        return new Ast.Table.Filter(table.table, newFilter, table.schema);
    }

    // FIXME deal with the other table types (maybe)

    return new Ast.Table.Filter(table, filter, table.schema);
}

function tableToStream(table, projArg) {
    if (!table.schema.is_monitorable)
        return null;
    let stream;
    if (table.isFilter && !table.schema.is_list)
        stream = new Ast.Stream.EdgeFilter(new Ast.Stream.Monitor(table.table, projArg, table.table.schema), table.filter, table.table.schema);
    else
        stream = new Ast.Stream.Monitor(table, projArg, table.schema);
    return stream;
}

function inParamsToFilters(in_params) {
    const operands = [];
    for (let param of in_params) {
        if (param.value.isUndefined)
            continue;
        operands.push(Ast.BooleanExpression.Atom(param.name, '==', param.value));
    }
    return Ast.BooleanExpression.And(operands);
}

function makePolicy(principal, table, action) {
    const policyAction = action ?
        new Ast.PermissionFunction.Specified(action.invocation.selector.kind, action.invocation.channel, inParamsToFilters(action.invocation.in_params), action.invocation.schema) :
        Ast.PermissionFunction.Builtin;

    let policyQuery = Ast.PermissionFunction.Builtin;
    if (table) {
        /*if (!table.schema.remote_confirmation || table.schema.remote_confirmation.indexOf('$__person') < 0)
            return null;*/

        if (table.isFilter && table.table.isInvocation) {
            const queryfilter = Ast.BooleanExpression.And([inParamsToFilters(table.table.invocation.in_params), table.filter]);
            policyQuery = new Ast.PermissionFunction.Specified(table.table.invocation.selector.kind, table.table.invocation.channel, queryfilter,
                table.table.invocation.schema);
        } else if (table.isInvocation) {
            const queryfilter = inParamsToFilters(table.invocation.in_params);
            policyQuery = new Ast.PermissionFunction.Specified(table.invocation.selector.kind, table.invocation.channel, queryfilter,
                table.invocation.schema);
        } else {
            return null;
        }
    }

    const sourcepredicate = principal ?
        Ast.BooleanExpression.Atom('source', '==', principal) : Ast.BooleanExpression.True;

    return new Ast.PermissionRule(sourcepredicate, policyQuery, policyAction);
}

function builtinSayAction($options, pname) {
    let selector = new Ast.Selector.Device('org.thingpedia.builtin.thingengine.builtin', null, null);
    if (pname instanceof Ast.Value) {
        let param = new Ast.InputParam('message', pname);
        return new Ast.Action.Invocation(Ast.Invocation(selector, 'say', [param], $options.standardSchemas.say),
            $options.standardSchemas.say.removeArgument('message'));
    } if (pname) {
        let param = new Ast.InputParam('message', new Ast.Value.VarRef(pname));
        return new Ast.Action.Invocation(new Ast.Invocation(selector, 'say', [param], $options.standardSchemas.say),
            $options.standardSchemas.say.removeArgument('message'));
    } else {
        return new Ast.Action.Invocation(new Ast.Invocation(selector, 'say', [], $options.standardSchemas.say),
            $options.standardSchemas.say.removeArgument('message'));
    }
}

function locationGetPredicate($options, loc, negate = false) {
    let filter = Ast.BooleanExpression.Atom('location', '==', loc);
    if (negate)
        filter = Ast.BooleanExpression.Not(filter);

    return new Ast.BooleanExpression.External(Ast.Selector.Device('org.thingpedia.builtin.thingengine.phone',null,null),'get_gps', [], filter,
        $options.standardSchemas.get_gps);
}

function timeGetPredicate($options, low, high) {
    let operands = [];

    if (low)
        operands.push(Ast.BooleanExpression.Atom('time', '>=', low));
    if (high)
        operands.push(Ast.BooleanExpression.Atom('time', '<=', high));
    const filter = Ast.BooleanExpression.And(operands);
    return new Ast.BooleanExpression.External(Ast.Selector.Device('org.thingpedia.builtin.thingengine.builtin',null,null),'get_time', [], filter,
        $options.standardSchemas.get_time);
}

function hasGetPredicate(filter) {
    if (filter.isAnd || filter.isOr) {
        for (let op of filter.operands) {
            if (hasGetPredicate(op))
                return true;
        }
        return false;
    }
    if (filter.isNot)
        return hasGetPredicate(filter.expr);
    return filter.isExternal;
}

function makeGetPredicate(proj, op, value, negate = false) {
    if (!proj.table.isInvocation)
        return null;
    let arg = proj.args[0];
    let filter = Ast.BooleanExpression.Atom(arg, op, value);
    if (negate)
        filter = Ast.BooleanExpression.Not(filter);
    const selector = proj.table.invocation.selector;
    const channel = proj.table.invocation.channel;
    const schema = proj.table.invocation.schema;
    if (!schema.out[arg].equals(value.getType()))
        return null;
    return new Ast.BooleanExpression.External(selector, channel, proj.table.invocation.in_params, filter, proj.table.invocation.schema);
}

// perform a join with parameter passing
function mergeSchemas(functionType, lhsSchema, rhsSchema, passign) {
    // handle parameter name conflicts by having the second primitive win
    const newArgNames = new Set;
    const newArgs = [];
    for (let argname of rhsSchema.args) {
        if (argname === passign)
            continue;
        newArgNames.add(argname);
        newArgs.push(rhsSchema.getArgument(argname));
    }
    for (let argname of lhsSchema.args) {
        if (newArgNames.has(argname))
            continue;
        if (!lhsSchema.isArgInput(argname))
            continue;
        newArgNames.add(argname);
        newArgs.push(lhsSchema.getArgument(argname));
    }

    return new Ast.ExpressionSignature(functionType,
        newArgs, // args
        lhsSchema.is_list || rhsSchema.is_list, // is_list
        lhsSchema.is_monitorable && rhsSchema.is_monitorable // is_monitorable
    );
}


function tableJoinReplacePlaceholder(into, pname, projection) {
    if (projection === null)
        return null;
    if (!projection.isProjection || !projection.table || projection.args.length !== 1)
        throw new TypeError('???');
    const joinArg = projection.args[0];
    if (joinArg === '$event' && ['p_body', 'p_message', 'p_caption', 'p_status'].indexOf(pname) < 0)
        return null;
    const ptype = joinArg === '$event' ? Type.String : projection.schema.out[joinArg];
    const intotype = into.schema.inReq[pname];
    if (!intotype || !ptype.equals(intotype))
        return null;

    let [passign, etaReduced] = etaReduceTable(into, pname);
    if (passign === undefined) {
        //console.error(`Ignored join between ${into} and ${projection}: cannot find parameter ${pname}`);
        return null;
    }
    //console.log('passign: ' + passign + ', ptype: ' + ptype);

    const newSchema = mergeSchemas('query', projection.schema, etaReduced.schema, passign);
    let replacement = joinArg === '$event' ? new Ast.Value.Event(null) : new Ast.Value.VarRef(joinArg);
    return new Ast.Table.Join(projection.table, etaReduced, [new Ast.InputParam(passign, replacement)], newSchema);
}

function actionReplaceParamWith(into, pname, projection) {
    const joinArg = projection.args[0];
    if (joinArg === '$event' && ['p_body', 'p_message', 'p_caption', 'p_status'].indexOf(pname) < 0)
        return null;
    const ptype = joinArg === '$event' ? Type.String : projection.schema.out[joinArg];
    const intotype = into.schema.inReq[pname];
    if (!intotype || !ptype.equals(intotype))
        return null;

    const replacement = joinArg === '$event' ? new Ast.Value.Event(null) : new Ast.Value.VarRef(joinArg);
    return betaReduceAction(into, pname, replacement);
}

function actionReplaceParamWithTable(into, pname, projection) {
    if (projection === null)
        return null;
    if (!projection.isProjection || !projection.table || projection.args.length !== 1)
        throw new TypeError('???');
    const reduced = actionReplaceParamWith(into, pname, projection);
    if (reduced === null)
        return null;
    return new Ast.Statement.Command(projection.table, [reduced]);
}

function actionReplaceParamWithStream(into, pname, projection) {
    if (projection === null)
        return null;
    if (!projection.isProjection || !projection.stream || projection.args.length !== 1)
        throw new TypeError('???');
    const reduced = actionReplaceParamWith(into, pname, projection);
    if (reduced === null)
        return null;
    return new Ast.Statement.Rule(projection.stream, [reduced]);
}

function getDoCommand(command, pname, joinArg) {
    //if (command.actions.length !== 1 || command.actions[0].selector.isBuiltin)
    //    throw new TypeError('???');
    let actiontype = command.actions[0].schema.inReq[pname];
    if (!actiontype)
        return null;
    let commandtype = joinArg.isEvent ? Type.String : command.table.schema.out[joinArg.name];
    if (!commandtype || !commandtype.equals(actiontype))
        return null;

    let reduced = betaReduceAction(command.actions[0], pname, joinArg);
    if (reduced === null)
        return null;
    return new Ast.Statement.Command(command.table, [reduced]);
}

function whenDoRule(rule, pname, joinArg) {
    //if (rule.actions.length !== 1 || rule.actions[0].selector.isBuiltin)
    //    throw new TypeError('???');
    let actiontype = rule.actions[0].schema.inReq[pname];
    if (!actiontype)
        return null;
    let commandtype = joinArg.isEvent ? Type.String : rule.stream.schema.out[joinArg.name];
    if (!commandtype || !commandtype.equals(actiontype))
        return null;
    if (joinArg.isEvent && (rule.stream.isTimer || rule.stream.isAtTimer))
        return null;

    let reduced = betaReduceAction(rule.actions[0], pname, joinArg);
    if (reduced === null)
        return null;
    return new Ast.Statement.Rule(rule.stream, [reduced]);
}

function whenGetStream(stream, pname, joinArg) {
    if (!stream.isJoin)
        throw new TypeError('???');
    let commandtype = stream.table.schema.inReq[pname];
    if (!commandtype)
        return null;
    let streamtype = joinArg.isEvent ? Type.String : stream.stream.schema.out[joinArg.name];
    if (!streamtype || !streamtype.equals(commandtype))
        return null;
    if (joinArg.isEvent && (stream.stream.isTimer || stream.stream.isAtTimer))
        return null;

    let [passign, etaReduced] = etaReduceTable(stream.table, pname);
    if (passign === undefined) {
        //console.error(`Ignored join between ${into} and ${projection}: cannot find parameter ${pname}`);
        return null;
    }
    //console.log('passign: ' + passign + ', ptype: ' + ptype);

    const newSchema = mergeSchemas('stream', stream.schema, etaReduced.schema, passign);
    return new Ast.Stream.Join(stream.stream, etaReduced, stream.in_params.concat([new Ast.InputParam(passign, joinArg)]), newSchema);
}

function isConstantAssignable(value, ptype) {
    if (!ptype)
        return false;
    if (!Type.isAssignable(value.getType(), ptype))
        return false;
    if (value.getType().isEnum && (!ptype.isEnum || ptype.entries.indexOf(value.value) < 0))
        return false;
    return true;
}

function replacePlaceholderWithConstant(lhs, pname, value, betaReducer) {
    let ptype = lhs.schema.inReq[pname];
    if (!isConstantAssignable(value, ptype))
        return null;
    if (ptype.isEnum && ptype.entries.indexOf(value.toJS()) < 0)
        return null;
    //if (pname === 'p_low')
    //    console.log('p_low := ' + ptype + ' / ' + value.getType());
    if (value.isDate && value.value === null && value.offset === null)
        return null;
    return betaReducer(lhs, pname, value);
}

function sayProjectionProgram($options, proj) {
    if (proj.args[0] === 'picture_url')
        return null;
    let outParams = Object.keys(proj.table.schema.out);
    if (outParams.length === 1 && $options.flags.turking)
        return null;
    return makeProgram(new Ast.Statement.Command(proj.table, [notifyAction()]));
}

function isQueryProgram(program) {
    let hasTrigger = program.rules.length > 0 && program.rules.some((r) => r.isRule);
    if (hasTrigger)
        return false;

    for (let [primType, prim] of program.iteratePrimitives(false)) {
        if (prim.selector.isBuiltin)
            continue;
        if (primType === 'action')
            return false;
    }

    return true;
}

function isCompleteProgram(program) {
    for (let [, slot] of program.iterateSlots()) {
        if (slot instanceof Ast.Selector)
            continue;
        if (slot.value.isUndefined)
            return false;
    }
    return true;
}

function replaceAnyParameterFromContext(context, newValue) {
    const type = newValue.getType();
    assert(!type.isAny);

    const slotsOfType = [];

    const clone = context.clone();
    for (let [schema, slot] of clone.iterateSlots()) {
        if (slot instanceof Ast.Selector)
            continue;
        if (slot.value.isVarRef)
            continue;
        let argname = slot.name;
        let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
        if (slot instanceof Ast.BooleanExpression && slot.operator === 'contains')
            type = type.elem;

        if (isConstantAssignable(newValue, type))
            slotsOfType.push(slot);
    }

    if (slotsOfType.length !== 1)
        return null;

    slotsOfType[0].value = newValue;
    return clone;
}

function fillNextSlot(program, newValue) {
    const clone = program.clone();
    for (let [schema, slot] of clone.iterateSlots()) {
        if (slot instanceof Ast.Selector)
            continue;
        if (slot.value.isVarRef || !slot.value.isUndefined)
            continue;

        let argname = slot.name;
        let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
        if (slot instanceof Ast.BooleanExpression && slot.operator === 'contains')
            type = type.elem;
        if (!isConstantAssignable(newValue, type))
            return null;

        slot.value = newValue;
        return clone;
    }

    return null;
}

module.exports = {
    typeToStringSafe,

    notifyAction,
    builtinSayAction,
    locationGetPredicate,
    timeGetPredicate,

    makeProgram,
    //combineRemoteProgram,
    makePolicy,
    combineStreamCommand,

    checkNotSelfJoinStream,

    betaReduceAction,
    betaReduceTable,
    betaReduceStream,

    replacePlaceholderWithConstant,
    tableJoinReplacePlaceholder,
    actionReplaceParamWithTable,
    actionReplaceParamWithStream,
    getDoCommand,
    whenDoRule,
    whenGetStream,

    makeFilter,
    makeEdgeFilterStream,
    checkFilter,
    addFilter,
    hasGetPredicate,
    makeGetPredicate,

    tableToStream,

    addUnit,

    sayProjectionProgram,

    isQueryProgram,
    isCompleteProgram,
    replaceAnyParameterFromContext,
    fillNextSlot
};
