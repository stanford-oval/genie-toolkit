// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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

import assert from 'assert';
import { Temporal } from '@js-temporal/polyfill';

import { Ast, Type } from 'thingtalk';
import * as Units from 'thingtalk-units';

import {
    Placeholder,
    ErrorMessage,
    ParamSlot,
    FilterValueSlot,
    FilterSlot,
    InputParamSlot,
    DomainIndependentFilterSlot,
    ExpressionWithCoreference,

    makeInputParamSlot,
    makeDomainIndependentFilter,
    makeFilter,
    makeAndFilter,
    makeDateRangeFilter,

    typeToStringSafe,
    isSameFunction,

    resolveJoin
} from './utils';
export {
    Placeholder,
    ErrorMessage,
    ParamSlot,
    FilterValueSlot,
    FilterSlot,
    InputParamSlot,
    DomainIndependentFilterSlot,
    ExpressionWithCoreference,

    makeInputParamSlot,
    makeDomainIndependentFilter,
    makeFilter,
    makeAndFilter,
    makeDateRangeFilter,
};
export * from './keyfns';

import type ThingpediaLoader from './load-thingpedia';

export type ArgMinMax = [ParamSlot, 'asc'|'desc'];

export function isEntityOfFunction(type : InstanceType<typeof Type.Entity>, schema : Ast.FunctionDef) {
    if (!schema.class)
        return false;
    return type.type === schema.class.name + ':' + schema.name;
}

function makeDate(base : Ast.Value|Date|Ast.DateEdge|Ast.DatePiece|Ast.WeekDayDate|null, operator : '+'|'-', offset : null) : Ast.Value;
function makeDate(base : Ast.Value|Date|Ast.DateEdge|Ast.DatePiece|Ast.WeekDayDate|null, operator : '+'|'-', offset : Ast.Value|null) : Ast.Value|null;
function makeDate(base : Ast.Value|Date|Ast.DateEdge|Ast.DatePiece|Ast.WeekDayDate|null, operator : '+'|'-', offset : Ast.Value|null) : Ast.Value|null {
    if (!(base instanceof Ast.Value))
        base = new Ast.Value.Date(base);
    if (offset === null)
        return base;
    if ((offset instanceof Ast.MeasureValue || offset instanceof Ast.NumberValue) &&
        offset.value === 0)
        return null;

    const value = new Ast.Value.Computation(operator, [base, offset],
        [Type.Date, new Type.Measure('ms'), Type.Date], Type.Date);
    return value;
}

function makeDateWithDateTime(base : Ast.Value|Date|Ast.DateEdge|Ast.DatePiece|Ast.WeekDayDate|null, time : Ast.Value|null) : Ast.Value {
    if (!(base instanceof Ast.Value))
        base = new Ast.Value.Date(base);
    if (time === null)
        return base;
    assert(time instanceof Ast.Value);

    const value = new Ast.Value.Computation("set_time", [base, time],
        [Type.Date, Type.Time, Type.Date], Type.Date);
    return value;
}

export function fixTwoYearNumber(year : number) {
    if (year >= 50)
        return 1900 + year;
    else
        return 2000 + year;
}

export function makeJSDate(year : number, month : number, loader : ThingpediaLoader) : Date {
    const datetz = Temporal.ZonedDateTime.from({
        timeZone: loader.timezone ?? Temporal.Now.timeZone(),
        year, month, day: 1,
    });
    return new Date(datetz.epochMilliseconds);
}

export function dateOrDatePiece(year : number|null, month : number|null, loader : ThingpediaLoader) : Date|Ast.DatePiece {
    if (year === null)
        return new Ast.DatePiece(year, month, null, null);
    else
        return makeJSDate(fixTwoYearNumber(year), month ?? 1, loader);
}

function makeMonthDateRange(year : number|null, month : number|null, loader : ThingpediaLoader) : [Ast.Value, Ast.Value] {
    return [
        makeDate(dateOrDatePiece(year, month, loader), '+', null),
        makeDate(dateOrDatePiece(year, month, loader), '+', new Ast.Value.Measure(1, 'mon'))!
    ];
}

class GetFunctionVisitor extends Ast.NodeVisitor {
    names : string[] = [];
    functions : Ast.FunctionDef[] = [];

    visitInvocation(invocation : Ast.Invocation) {
        this.names.push(invocation.selector.kind + '.' + invocation.channel);
        this.functions.push(invocation.schema as Ast.FunctionDef);
        return true;
    }
}

function getFunctionNames(ast : Ast.Node) : string[] {
    const visitor = new GetFunctionVisitor();
    ast.visit(visitor);
    return visitor.names;
}

function getFunctions(ast : Ast.Node) : Ast.FunctionDef[] {
    const visitor = new GetFunctionVisitor();
    ast.visit(visitor);
    return visitor.functions;
}

function isSelfJoinStream(stream : Ast.Expression) : boolean {
    const functions = getFunctionNames(stream);
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

export function betaReduceMany<T extends Ast.Expression|Ast.Invocation>(ast : T, replacements : Record<string, Ast.Value>) : T|null {
    const clone = ast.clone() as T;

    for (const slot of clone.iterateSlots2({})) {
        if (slot instanceof Ast.DeviceSelector)
            continue;

        const varref = slot.get();
        if (varref instanceof Ast.VarRefValue) {
            const pname = varref.name;
            if (!(pname in replacements))
                continue;
            if (pname in slot.scope) {
                // if the parameter is in scope of the slot, it means we're in a filter and the same parameter name
                // is returned by the stream/table, which shadows the example/declaration parameter we're
                // trying to replace, hence we ignore this slot
                continue;
            }

            const replacement = replacements[pname];
            assert(replacement instanceof Ast.Value);

            // no parameter passing or undefined into device attributes
            if ((replacement.isUndefined || replacement instanceof Ast.EventValue
                || (replacement instanceof Ast.VarRefValue && !replacement.name.startsWith('__const')))
                && slot.tag.startsWith('attribute.'))
                return null;

            slot.set(replacement);
        }
    }
    return clone;
}

export function makeDontCareFilter(slot : ParamSlot) : FilterSlot {
    return { schema: slot.schema, ptype : slot.type, ast: new Ast.BooleanExpression.DontCare(null, slot.name) };
}

function makeOrFilter(tpLoader : ThingpediaLoader,
                      slot : ParamSlot,
                      op : string,
                      values : [Ast.Value, Ast.Value],
                      negate = false) : FilterSlot|null {
    if (values.length !== 2)
        return null;
    if (values[0].equals(values[1]))
        return null;
    const operands = [
        makeFilter(tpLoader, slot, op, values[0], negate),
        makeFilter(tpLoader, slot, op, values[1], negate)
    ] as const;
    if (operands[0] === null || operands[1] === null)
        return null;
    let ast = new Ast.BooleanExpression.Or(null, [operands[0].ast, operands[1].ast]);
    if (negate)
        ast = new Ast.BooleanExpression.Not(null, ast);
    return { schema: slot.schema, ptype : slot.type, ast };
}

function makeButFilter(tpLoader : ThingpediaLoader,
                       slot : ParamSlot,
                       op : string,
                       values : [Ast.Value, Ast.Value]) : FilterSlot|null {
    if (values.length !== 2)
        return null;
    if (values[0].equals(values[1]))
        return null;
    const operands  = [
        makeFilter(tpLoader, slot, op, values[0]),
        makeFilter(tpLoader, slot, op, values[1], true)
    ] as const;
    if (operands[0] === null || operands[1] === null)
        return null;
    const ast = new Ast.BooleanExpression.And(null, [operands[0].ast, operands[1].ast]);
    return { schema: slot.schema, ptype : slot.type, ast };
}

function makeListExpression(param : ParamSlot, filter : FilterSlot) : FilterValueSlot|null {
    if (!isSameFunction(param.schema, filter.schema))
        return null;
    // TODO: handle more complicated filters
    if (!(filter instanceof Ast.AtomBooleanExpression))
        return null;
    // TODO check that the filter is valid inside this compound array...
    return null;
    //return { schema: param.schema, ast: new Ast.Value.Filter(param, filter) };
}

function normalizeFilter(filter : Ast.ComputeBooleanExpression, schema : Ast.FunctionDef) : FilterSlot|null {
    if (filter.lhs instanceof Ast.ComputationValue &&
        filter.lhs.op === 'count' &&
        filter.lhs.operands.length === 1) {
        const op1 = filter.lhs.operands[0];
        assert(op1 instanceof Ast.VarRefValue);
        const name = op1.name;
        const canonical = schema!.getArgCanonical(name);
        if (!canonical)
            return null;
        for (const p of schema!.iterateArguments()) {
            if (p.name === name + 'Count' ||
                p.canonical === canonical + ' count' ||
                p.canonical === canonical.slice(0,-1) + ' count')
                return { schema, ptype: schema.getArgType(p.name)!, ast: new Ast.BooleanExpression.Atom(null, p.name, filter.operator, filter.rhs) };
        }
    }

    return { schema, ptype: filter.lhs.getType(), ast: filter };
}

function makeAggregateFilter(param : ParamSlot,
                             aggregationOp : string,
                             field : ParamSlot|'*'|null,
                             op : string,
                             value : Ast.Value) : FilterSlot|null {
    if (aggregationOp === 'count') {
        if (!value.getType().isNumber)
            return null;
        assert(field === null || field === '*');
        const agg = new Ast.Value.Computation(aggregationOp, [param.ast],
            [new Type.Array('x'), Type.Number], Type.Number);
        return normalizeFilter(new Ast.BooleanExpression.Compute(null, agg, op, value), param.schema);
    } else if (['sum', 'avg', 'max', 'min'].includes(aggregationOp)) {
        const vtype = value.getType();
        const ptype = param.type;
        assert(field !== '*');
        if (field !== null) {
            if (!isSameFunction(param.schema, field.schema))
                return null;
            if (!(ptype instanceof Type.Array))
                return null;
            const eltype = ptype.elem;
            if (!(eltype instanceof Type.Compound))
                return null;
            if (!(field.name in eltype.fields))
                return null;
        }
        const agg = new Ast.Value.Computation(aggregationOp, [
            field ? new Ast.Value.ArrayField(param.ast, field.name) : param.ast
        ], [new Type.Array(vtype), vtype], vtype);
        return normalizeFilter(new Ast.BooleanExpression.Compute(null, agg, op, value), param.schema);
    }
    return null;
}

function makeAggregateFilterWithFilter(param : ParamSlot,
                                       filter : FilterSlot|null,
                                       aggregationOp : string,
                                       field : ParamSlot|'*'|null,
                                       op : string,
                                       value : Ast.Value) : FilterSlot|null {
    if (filter === null)
        return null;
    if (!isSameFunction(param.schema, filter.schema))
        return null;
    const list = makeListExpression(param, filter);
    if (!list)
        return null;
    if (aggregationOp === 'count') {
        if (!value.getType().isNumber)
            return null;
        assert(field === '*');
        const agg = new Ast.Value.Computation(aggregationOp, [list.ast], [new Type.Array('x'), Type.Number], Type.Number);
        return normalizeFilter(new Ast.BooleanExpression.Compute(null, agg, op, value), param.schema);
    } else if (['sum', 'avg', 'max', 'min'].includes(aggregationOp)) {
        const vtype = value.getType();
        const ptype = param.type;
        assert(field !== '*');
        if (field !== null) {
            if (!isSameFunction(param.schema, field.schema))
                return null;
            if (!(ptype instanceof Type.Array))
                return null;
            const eltype = ptype.elem;
            if (!(eltype instanceof Type.Compound))
                return null;
            if (!(field.name in eltype.fields))
                return null;
        }
        const agg = new Ast.Value.Computation(aggregationOp, [
            field ? new Ast.Value.ArrayField(param.ast, field.name) : param.ast
        ], [new Type.Array(vtype), vtype], vtype);
        return normalizeFilter(new Ast.BooleanExpression.Compute(null, agg, op, value), param.schema);
    }
    return null;
}

const cachedInputOuputParamCount = new WeakMap<Ast.FunctionDef, {
    input : number,
    output : number
}>();
export function countInputOutputParams(fndef : Ast.FunctionDef) {
    const cached = cachedInputOuputParamCount.get(fndef);
    if (cached !== undefined)
        return cached;

    const computed = {
        input : 0,
        output : 0
    };
    for (const arg of fndef.iterateArguments()) {
        if (arg.is_input)
            computed.input++;
        else
            computed.output++;
    }
    cachedInputOuputParamCount.set(fndef, computed);
    return computed;
}

function makeEdgeFilterStream(loader : ThingpediaLoader,
                              proj : Ast.Expression,
                              op : string,
                              value : Ast.Value) : Ast.Expression|null {
    if (!(proj instanceof Ast.ProjectionExpression))
        return null;
    if (proj.args[0] === '$event')
        return null;

    const args = getProjectionArguments(proj);
    assert(args.length > 0);
    const f = {
        schema: proj.schema!,
        ptype: proj.schema!.getArgType(args[0])!,
        ast: new Ast.BooleanExpression.Atom(null, args[0], op, value)
    };
    if (!checkFilter(loader, proj.expression, f))
        return null;
    if (!proj.schema!.is_monitorable || proj.schema!.is_list)
        return null;
    if (countInputOutputParams(proj.expression.schema!).output === 1 && loader.flags.turking)
        return null;

    const monitor = new Ast.MonitorExpression(null, proj.expression, null, proj.expression.schema!.asType('stream'));
    return new Ast.FilterExpression(null, monitor, f.ast, monitor.schema);
}

function addUnit(unit : string, num : Ast.VarRefValue | Ast.NumberValue) : Ast.Value {
    if (num instanceof Ast.VarRefValue) {
        const v = new Ast.Value.VarRef(num.name + '__' + unit);
        (v as any).unit = unit;
        v.getType = () => new Type.Measure(unit);
        return v;
    } else {
        return new Ast.Value.Measure(num.value, unit);
    }
}

export function getScalarExpressionName(ast : Ast.Value) : string {
    if (ast instanceof Ast.VarRefValue)
        return ast.name;
    if (ast instanceof Ast.ComputationValue && /^[a-zA-Z0-9]+$/.test(ast.op))
        return ast.op;
    else if (ast instanceof Ast.FilterValue || ast instanceof Ast.ArrayFieldValue)
        return getScalarExpressionName(ast.value);
    else
        return 'result';
}

function getComputationNames(computations : Ast.Value[] = [],
                             aliases : Array<string|null> = []) {
    const names : string[] = [];

    for (let i = 0; i < computations.length; i++) {
        const comp = computations[i];
        names.push(aliases[i] || getScalarExpressionName(comp));
    }

    return names;
}

/**
 * Return all names that are explicitly projected by a projection.
 *
 * This is equivalent to all the output parameters minus the minimal projection.
 */
export function getProjectionArguments(table : Ast.ProjectionExpression) : string[] {
    assert(table.args.length + table.computations.length > 0);
    return table.args.concat(getComputationNames(table.computations, table.aliases));
}

function resolveProjection(schema : Ast.FunctionDef,
                           args : string[],
                           computations : Ast.Value[] = [],
                           aliases : Array<string|null> = []) : Ast.FunctionDef {
    assert(args.length >= 1 || computations.length > 0);

    const argset = new Set(args);
    for (const argname of schema.minimal_projection||[])
        argset.add(argname);
    for (const argname of argset) {
        const arg = schema.getArgument(argname);
        if (!arg || arg.is_input) {
            console.log(schema.prettyprint(), argname);
            throw new TypeError('Invalid field name ' + argname);
        }
    }
    let clone = schema.filterArguments((a : Ast.ArgumentDef) => a.is_input || argset.has(a.name));

    const newArgs = [];
    for (let i = 0; i < computations.length; i++) {
        const comp = computations[i];
        const name = aliases[i] || getScalarExpressionName(comp);
        const type = comp.getType();

        newArgs.push(new Ast.ArgumentDef(schema.location,
            Ast.ArgDirection.OUT, name, type));
    }

    clone = clone.addArguments(newArgs);
    clone.default_projection = [];
    assert(Array.isArray(clone.minimal_projection));
    return clone;
}

function makeProjection(table : Ast.Expression, pname : string) : Ast.ProjectionExpression {
    return new Ast.ProjectionExpression(null, table, [pname], [], [], resolveProjection(table.schema!, [pname]));
}

/**
 * Compute the parameter passing to use from a table if a parameter name is
 * not spefified explicitly.
 */
export function getImplicitParameterPassing(schema : Ast.FunctionDef) : string {
    // if there is only one parameter, that's the one
    let firstOutParam : string|undefined|null = undefined;
    for (const arg of schema.iterateArguments()) {
        if (arg.is_input)
            continue;
        if (firstOutParam === undefined) {
            firstOutParam = arg.name;
        } else {
            firstOutParam = null;
            break;
        }
    }
    if (firstOutParam !== null && firstOutParam !== undefined)
        return firstOutParam;

    // if there is an ID, we pick that one
    const id = schema.getArgument('id');
    if (id && !id.is_input)
        return 'id';
    // if there is a picture, we pick that one
    const picture_url = schema.getArgument('picture_url');
    if (picture_url && !picture_url.is_input)
        return 'picture_url';

    // failing everything, return a string representation of the table
    return '$event';
}

export function makeTypeBasedTableProjection(tpLoader : ThingpediaLoader,
                                             table : Ast.Expression,
                                             intotype : Type = Type.Any) : Ast.ProjectionExpression|null {
    if (table instanceof Ast.ProjectionExpression)
        return null;

    const pname = getImplicitParameterPassing(table.schema!);
    if (pname === '$event') {
        if (!Type.isAssignable(Type.String, intotype, {}, tpLoader.entitySubTypeMap))
            return null;
        // FIXME this is bogus on various levels, because $event is not an argument
        // because the schema is not modified correctly...
        return new Ast.ProjectionExpression(null, table, ['$event'], [], [], table.schema);
    } else {
        if (!Type.isAssignable(table.schema!.getArgType(pname)!, intotype, {}, tpLoader.entitySubTypeMap))
            return null;
        return makeProjection(table, pname);
    }
}

export function makeTypeBasedStreamProjection(table : Ast.Expression) : Ast.ProjectionExpression|null {
    if (table instanceof Ast.ProjectionExpression)
        return null;
    if (!table.schema!.is_monitorable)
        return null;

    const pname = getImplicitParameterPassing(table.schema!);
    if (pname === '$event')
        return null;

    return makeProjection(new Ast.MonitorExpression(null, table, null, table.schema!.asType('stream')), pname);
}

function isEqualityFilteredOnParameter(table : Ast.Expression, pname : string) : boolean {
    for (const [,filter] of iterateFilters(table)) {
        for (const field of iterateFields(filter)) {
            if (field instanceof Ast.AtomBooleanExpression && field.name === pname && 
                (field.operator === '==' || field.operator === '=~'))
                return true;
        }
    }

    return false;
}

function makeSingleFieldProjection(loader : ThingpediaLoader,
                                   ftype : 'table'|'stream',
                                   ptype : Type|null,
                                   table : Ast.Expression,
                                   param : ParamSlot|'geo') : Ast.Expression|null {
    assert(table);
    assert(ftype === 'table' || ftype === 'stream');

    let pname;
    if (param === 'geo') {
        pname = 'geo';
    } else {
        if (!isSameFunction(table.schema!, param.schema))
            return null;
        pname = param.name;
    }
    const arg = table.schema!.getArgument(pname);
    if (!arg || arg.is_input)
        return null;

    if (countInputOutputParams(table.schema!).output === 1)
        return table;

    if (ptype && !Type.isAssignable(arg.type, ptype, {}, loader.entitySubTypeMap))
        return null;

    if (ftype === 'table') {
        if (pname === 'picture_url' && loader.flags.turking)
            return null;
        if (isEqualityFilteredOnParameter(table, pname))
            return null;
        return makeProjection(table, pname);
    } else {
        if (!table.schema!.is_monitorable)
            return null;
        const stream = new Ast.MonitorExpression(null, table, null, table.schema!.asType('stream'));
        return makeProjection(stream, pname);
    }
}

function makeMultiFieldProjection(loader : ThingpediaLoader,
                                  ftype : 'table'|'stream',
                                  table : Ast.Expression,
                                  outParams : ParamSlot[]) : Ast.Expression|null {
    const names = [];
    for (const outParam of outParams) {
        if (!isSameFunction(table.schema!, outParam.schema))
            return null;
        const name = outParam.name;
        const arg = table.schema!.getArgument(name);
        if (!arg || arg.is_input)
            return null;

        if (ftype === 'table') {
            if (name === 'picture_url' && loader.flags.turking)
                return null;
        } else {
            if (!table.schema!.is_monitorable)
                return null;
        }

        names.push(name);
    }

    if (ftype === 'table') {
        for (const pname of names) {
            if (isEqualityFilteredOnParameter(table, pname))
                return null;
        }

        return new Ast.ProjectionExpression(null, table, names, [], [], resolveProjection(table.schema!, names));
    } else {
        const stream = new Ast.MonitorExpression(null, table, null, table.schema!.asType('stream'));
        return new Ast.ProjectionExpression(null, stream, names, [], [], resolveProjection(stream.schema!, names));
    }
}

function makeArgMaxMinTable(table : Ast.Expression, pname : string, direction : 'asc'|'desc', count ?: Ast.Value) : Ast.SliceExpression|null {
    const t_sort = makeSortedTable(table, pname, direction);

    if (!t_sort)
        return null;

    count = count || new Ast.Value.Number(1);
    if (count instanceof Ast.Value.Number && count.value <= 0)
        return null;

    return new Ast.SliceExpression(null, t_sort, new Ast.Value.Number(1), count, t_sort.schema);
}

function makeSortedTable(table : Ast.Expression, pname : string, direction = 'desc') : Ast.SortExpression|null {
    assert(typeof pname === 'string');
    assert(direction === 'asc' || direction === 'desc');

    const type = table.schema!.getArgType(pname);
    // String are comparable but we don't want to sort alphabetically here
    // (we need to use isComparable because Date/Time are comparable but not numeric)
    if (!type || !type.isComparable() || type.isString)
        return null;
    if (!table.schema!.is_list || table instanceof Ast.IndexExpression) //avoid conflict with primitives
        return null;
    if (hasUniqueFilter(table))
        return null;

    for (const [,filter] of iterateFilters(table)) {
        for (const atom of iterateFields(filter)) {
            if ('name' in atom && atom.name === pname)
                return null;
            if ('lhs' in atom && atom.lhs instanceof Ast.Value.VarRef && atom.lhs.name === pname)
                return null;
        }
    }

    if (hasUniqueFilter(table))
        return null;
    return new Ast.SortExpression(null, table, new Ast.Value.VarRef(pname), direction, table.schema);
}

class HasIDFilterVisitor extends Ast.NodeVisitor {
    hasIDFilter = false;

    visitAtomBooleanExpression(expr : Ast.AtomBooleanExpression) {
        if (expr.name === 'id' && expr.operator === '==')
            this.hasIDFilter = true;
        return true;
    }
}

function checkValidQuery(table : Ast.Expression) : boolean {
    // check that the query does not include "id ==" (it should be "id =~")
    // this check is only applied at the first turn (or first turn of a new domain)
    const filterExpression = findFilterExpression(table);
    if (!filterExpression)
        return true;

    const visitor = new HasIDFilterVisitor();
    filterExpression.filter.visit(visitor);
    return !visitor.hasIDFilter;
}

export function toChainExpression(expr : Ast.Expression) {
    if (expr instanceof Ast.ChainExpression)
        return expr;
    else
        return new Ast.ChainExpression(null, [expr], expr.schema);
}

function makeProgram(loader : ThingpediaLoader,
                     rule : Ast.Expression) : Ast.Program|null {
    if (!loader.flags.no_soft_match_id && !checkValidQuery(rule))
        return null;
    const chain = toChainExpression(rule);
    if (chain.first.schema!.functionType === 'stream' && loader.flags.nostream)
        return null;
    return adjustDefaultParameters(new Ast.Program(null, [], [], [new Ast.ExpressionStatement(null, chain)]));
}

function combineStreamCommand(stream : Ast.Expression, command : Ast.ChainExpression) : Ast.ChainExpression|null {
    const join = makeChainExpression(stream, command);
    if (isSelfJoinStream(join))
        return null;
    return join;
}

export function combineStreamQuery(loader : ThingpediaLoader,
                                   stream : Ast.Expression,
                                   table : Ast.Expression) : Ast.ChainExpression|null {
    if (table instanceof Ast.ProjectionExpression) {
        if (!loader.flags.projection)
            return null;
        if (table.args[0] === 'picture_url' || table.args[0] === '$event')
            return null;
        if (countInputOutputParams(table.expression.schema!).output === 1)
            return null;
    }
    if (isSameFunction(stream.schema!, table.schema!))
        return null;
    return new Ast.ChainExpression(null, [stream, table], table.schema);
}

function checkQualifier(ptype : Type.Compound, filter : Ast.BooleanExpression) : boolean {
    for (const atom of iterateFields(filter)) {
        let field;
        if (atom instanceof Ast.AtomBooleanExpression)
            field = atom.name;
        else if (atom instanceof Ast.ComparisonSubqueryBooleanExpression)
            field = (atom.lhs as Ast.VarRefValue).name;
        if (!field)
            return false;
        if (!(field in ptype.fields))
            return false;
    }
    // TODO: typecheck filter inside qualifiedValue
    return true;    
}

function checkQualifiedFilter(loader : ThingpediaLoader, table : Ast.Expression, filter : Ast.ComputeBooleanExpression) : boolean {
    const qualifiedValue = filter.lhs as Ast.FilterValue;
    if (!(qualifiedValue.value instanceof Ast.Value.VarRef))
        return false;
    const ptype = table.schema!.getArgType(qualifiedValue.value.name);
    if (!ptype) 
        return false;
    if (!(ptype instanceof Type.Array))
        return false;
    if (!(ptype.elem instanceof Type.Compound))
        return false;
    if (!Type.isAssignable(filter.rhs.getType(), ptype.elem, {}, loader.entitySubTypeMap)) 
        return false;
    return checkQualifier(ptype.elem, qualifiedValue.filter);
}

function checkComputeFilter(loader : ThingpediaLoader, table : Ast.Expression, filter : Ast.ComputeBooleanExpression) : boolean {
    if (!(filter.lhs instanceof Ast.ComputationValue) && !(filter.lhs instanceof Ast.FilterValue))
        return false;

    if (filter.lhs instanceof Ast.FilterValue) 
        return checkQualifiedFilter(loader, table, filter);

    // distance
    if (filter.lhs.op === 'distance') {
        assert.strictEqual(filter.lhs.operands.length, 2);
        if (!(filter.rhs instanceof Ast.MeasureValue) || Units.normalizeUnit(filter.rhs.unit) !== 'm')
            return false;
        for (const operand of filter.lhs.operands) {
            if (operand instanceof Ast.VarRefValue && !table.schema!.hasArgument(operand.name))
                return false;
            if (!(operand.isVarRef || operand.isLocation))
                return false;
        }
        return true;
    }

    // count, sum, avg, min, max
    if (filter.lhs.operands.length !== 1)
        return false;
    const param = filter.lhs.operands[0];
    if (!(param instanceof Ast.VarRefValue))
        return false;

    let vtype, ftype;
    const ptype = table.schema!.getArgType(param.name);
    if (!ptype)
        return false;
    if (!(ptype instanceof Type.Array))
        return false;
    if (filter.lhs.op === 'count') {
        vtype = Type.Number;
        const canonical = table.schema!.getArgCanonical(param.name)!;
        for (const p of table.schema!.iterateArguments()) {
            if (p.name === param.name + 'Count')
                return false;
            if (p.canonical === canonical + 'count' || p.canonical === canonical.slice(0,-1) + ' count')
                return false;
        }
    } else {
        // ???
        //if (param.field && param.field in ptype.elem.fields)
        //    ftype = ptype.elem.fields[param.field].type;
        //else
        ftype = ptype.elem as Type;
        vtype = ftype;
    }
    return filter.rhs.getType().equals(vtype);
}

function checkAtomFilter(loader : ThingpediaLoader, table : Ast.Expression, filter : Ast.AtomBooleanExpression) : boolean {
    const arg = table.schema!.getArgument(filter.name);
    if (!arg || arg.is_input)
        return false;

    if (arg.getAnnotation('filterable') === false)
        return false;

    const ptype = arg.type;
    const vtype = ptype;
    let vtypes : Type[] = [ptype];
    if (filter.operator === 'contains') {
        if (ptype instanceof Type.Array)
            vtypes = [ptype.elem as Type];
        else if (ptype === Type.RecurrentTimeSpecification)
            vtypes = [Type.Date, Type.Time];
        else
            return false;
    } else if (filter.operator === 'contains~') {
        if (!(vtype instanceof Type.Array) || (!(vtype.elem instanceof Type.Entity) && vtype.elem !== Type.String))
            return false;
        vtypes = [Type.String];
    } else if (filter.operator === 'in_array') {
        vtypes = [new Type.Array(ptype)];
    } else if (filter.operator === 'in_array~') {
        if (!vtype.isEntity && !vtype.isString)
            return false;
        vtypes = [new Type.Array(Type.String)];
    } else if (filter.operator === '=~') {
        if (!ptype.isEntity && !ptype.isString)
            return false;
        if (ptype.isEntity && filter.name !== 'id')
            return false;
        vtypes = [Type.String];
    }

    let typeMatch = false;
    const valueType = filter.value.getType();
    const parentTypes = valueType instanceof Type.Entity ? loader.entitySubTypeMap[valueType.type] || [] : [];
    for (const type of vtypes) {
        if (Type.isAssignable(valueType, type, {}, loader.entitySubTypeMap)) {
            typeMatch = true;
            break;
        } else if (type instanceof Type.Entity && parentTypes.includes(type.type)) {
            typeMatch = true;
            break;
        }
    }
    if (!typeMatch)
        return false;

    if (vtype.isNumber || vtype.isMeasure) {
        let min = -Infinity;
        const minArg = arg.getImplementationAnnotation<number>('min_number');
        if (minArg !== undefined)
            min = minArg;
        const maxArg = arg.getImplementationAnnotation<number>('max_number');
        let max = Infinity;
        if (maxArg !== undefined)
            max = maxArg;

        if (filter.value.isNumber) {
            const value = filter.value.toJS() as number;
            if (min >= 0 && min <= 12 && value < min)
                return false;
            if (max >= 0 && max <= 12 && value > max)
                return false;
        }
    }
    return true;
}

function internalCheckFilter(loader : ThingpediaLoader, table : Ast.Expression, filter : Ast.BooleanExpression) : boolean {
    while (table instanceof Ast.ProjectionExpression)
        table = table.expression;

    if (filter instanceof Ast.NotBooleanExpression)
        filter = filter.expr;
    if (filter instanceof Ast.ExternalBooleanExpression) // FIXME
        return true;
    if (filter instanceof Ast.AndBooleanExpression ||
        filter instanceof Ast.OrBooleanExpression) {
        for (const operands of filter.operands) {
            if (!internalCheckFilter(loader, table, operands))
                return false;
        }
        return true;
    }

    if (filter instanceof Ast.ComputeBooleanExpression)
        return checkComputeFilter(loader, table, filter);

    if (filter instanceof Ast.AtomBooleanExpression)
        return checkAtomFilter(loader, table, filter);

    if (filter instanceof Ast.DontCareBooleanExpression) {
        const arg = table.schema!.getArgument(filter.name);
        if (!arg || arg.is_input)
            return false;
        if (arg.getAnnotation<boolean>('filterable') === false)
            return false;
        return true;
    }

    throw new Error(`Unexpected filter type ${filter}`);
}

function checkFilter(loader : ThingpediaLoader, table : Ast.Expression, filter : FilterSlot|DomainIndependentFilterSlot) : boolean {
    if (filter.schema !== null && !isSameFunction(table.schema!, filter.schema))
        return false;
    return internalCheckFilter(loader, table, filter.ast);
}

function* iterateFilters(table : Ast.Expression) : Generator<[Ast.FunctionDef, Ast.BooleanExpression], void> {
    if (table instanceof Ast.InvocationExpression ||
        table instanceof Ast.FunctionCallExpression)
        return;

    if (table instanceof Ast.FilterExpression) {
        yield [table.schema!, table.filter];
    } else if (table instanceof Ast.ChainExpression) {
        for (const expr of table.expressions)
            yield *iterateFilters(expr);
    } else {
        yield *iterateFilters((table as Ast.Expression & { expression : Ast.Expression }).expression);
    }
}

function* iterateFields(filter : Ast.BooleanExpression) : Generator<Ast.AtomBooleanExpression|Ast.DontCareBooleanExpression|Ast.ComparisonSubqueryBooleanExpression, void> {
    assert(filter instanceof Ast.BooleanExpression);
    if (filter instanceof Ast.AndBooleanExpression) {
        for (const operand of filter.operands)
            yield *iterateFields(operand);
    } else if (filter instanceof Ast.NotBooleanExpression) {
        yield *iterateFields(filter.expr);
    } else if (filter instanceof Ast.AtomBooleanExpression || filter instanceof Ast.DontCareBooleanExpression) {
        yield filter;
    } else if (filter instanceof Ast.ComparisonSubqueryBooleanExpression) { 
        yield filter;
    } else {
        assert(filter.isTrue || filter.isFalse || filter.isOr || filter.isCompute || filter.isExternal || filter.isExistentialSubquery);
    }
}

function hasUniqueFilter(table : Ast.Expression) : boolean {
    for (const [, filter] of iterateFilters(table)) {
        if (checkFilterUniqueness(table, filter))
            return true;
    }
    return false;
}

function checkFilterUniqueness(table : Ast.Expression, filter : Ast.BooleanExpression) : boolean {
    if (filter instanceof Ast.AndBooleanExpression)
        return filter.operands.some((f) => checkFilterUniqueness(table, f));
    // note: a filter of the form
    // (id == "foo" || id == "bar")
    // is treated as "unique" because it defines the set of elements
    // and we should not filter further
    if (filter instanceof Ast.OrBooleanExpression)
        return filter.operands.every((f) => checkFilterUniqueness(table, f));

    if (filter instanceof Ast.ExternalBooleanExpression)
        return false;

    if (filter instanceof Ast.ComparisonSubqueryBooleanExpression ||
        filter instanceof Ast.ExistentialSubqueryBooleanExpression)
        return false;

    if (filter instanceof Ast.NotBooleanExpression)
        return true;

    if (filter.isTrue || filter.isFalse)
        return false;

    if (filter instanceof Ast.ComputeBooleanExpression ||
        filter instanceof Ast.DontCareBooleanExpression)
        return false;
    assert(filter instanceof Ast.AtomBooleanExpression);

    if (filter.operator !== '==' && filter.operator !== 'in_array')
        return false;

    const arg = table.schema!.getArgument(filter.name);
    if (!arg)
        return false;
    return arg.unique;
}

interface AddFilterOptions {
    ifFilter ?: boolean;
}

function addFilterInternal(table : Ast.Expression,
                           filter : Ast.BooleanExpression,
                           options : AddFilterOptions) : Ast.Expression|null {
    // when an "unique" parameter has been used in the table
    if (table.schema!.no_filter)
        return null;

    // if the query is single result, only add "if" filters, not "with" filters
    // ("if" filters are only used with streams)
    if (!table.schema!.is_list && !options.ifFilter)
        return null;

    // go inside these to add a filter, so we can attach a filter to a primitive
    // template that uses some of these expressions
    //
    // note: optimize() will take care of projection and sort, but not index
    // and slice, because index of a filter is different than filter of a index
    // the semantics in natural language are always of index of a filter!
    if (table instanceof Ast.ProjectionExpression ||
        table instanceof Ast.SortExpression ||
        table instanceof Ast.IndexExpression ||
        table instanceof Ast.SliceExpression) {
        const added = addFilterInternal(table.expression, filter, options);
        if (added === null)
            return null;
        if (table instanceof Ast.ProjectionExpression)
            return new Ast.ProjectionExpression(null, added, table.args, table.computations, table.aliases, table.schema);
        else if (table instanceof Ast.SortExpression)
            return new Ast.SortExpression(null, added, table.value, table.direction, table.schema);
        else if (table instanceof Ast.IndexExpression)
            return new Ast.IndexExpression(null, added, table.indices, table.schema);
        else
            return new Ast.SliceExpression(null, added, table.base, table.limit, table.schema);
    }

    if (table instanceof Ast.FilterExpression) {
        // if we already have a filter, don't add a new complex filter
        if (!filter.isAtom && 
            !(filter instanceof Ast.NotBooleanExpression && filter.expr.isAtom) &&
            !(filter instanceof Ast.ComputeBooleanExpression && filter.lhs instanceof Ast.FilterValue))
            return null;

        if (checkFilterUniqueness(table, filter))
            return null;

        if (hasUniqueFilter(table))
            return null;

        const existing = table.filter;
        let atom = filter;
        if (atom instanceof Ast.NotBooleanExpression)
            atom = atom.expr;
        if (atom instanceof Ast.ComputeBooleanExpression) 
            atom = new Ast.BooleanExpression.Atom(null, ((atom.lhs as Ast.FilterValue).value as Ast.VarRefValue).name, atom.operator, atom.rhs);
        assert(atom instanceof Ast.AtomBooleanExpression);
        // check that we don't create a non-sensical filter, eg.
        // p == X && p == Y, or p > X && p > Y
        const operands = existing instanceof Ast.AndBooleanExpression ? existing.operands : [existing];
        for (const operand of operands) {
            if (operand instanceof Ast.AtomBooleanExpression &&
                operand.name === atom.name &&
                (operand.operator === atom.operator ||
                 operand.operator === '==' ||
                 atom.operator === '==' ||
                 operand.operator === 'in_array' ||
                 atom.operator === 'in_array'))
                return null;
        }

        const arg = table.schema!.getArgument(atom.name)!;
        const conflict = arg.getImplementationAnnotation<string[]>('conflict_filter');
        if (conflict !== undefined) {
            for (const atom2 of iterateFields(existing)) {
                if ('name' in atom2 && conflict.includes(atom2.name))
                    return null;
                if ('lhs' in atom2 && atom2.lhs instanceof Ast.Value.VarRef && conflict.includes(atom2.lhs.name))
                    return null;
            }
        }

        const newFilter = new Ast.BooleanExpression.And(null, [existing, filter]).optimize();
        return new Ast.FilterExpression(null, table.expression, newFilter, table.schema);
    }

    // FIXME deal with the other table types (maybe)

    const schema = table.schema!.clone();
    if (checkFilterUniqueness(table, filter)) {
        schema.is_list = false;
        schema.no_filter = true;
    }
    return new Ast.FilterExpression(null, table, filter, schema);
}

function addFilter(loader : ThingpediaLoader,
                   table : Ast.Expression,
                   filter : FilterSlot|DomainIndependentFilterSlot,
                   options : AddFilterOptions = {}) : Ast.Expression|null {
    if (!checkFilter(loader, table, filter))
        return null;

    return addFilterInternal(table, filter.ast, options);
}

function makeVerificationQuestion(loader : ThingpediaLoader,
                                  table : Ast.Expression,
                                  filter : FilterSlot|DomainIndependentFilterSlot,
                                  negate = false) : Ast.Expression|null {
    if (!checkFilter(loader, table, filter))
        return null;
    let verification;    
    if (negate) {
        if (filter.ast instanceof Ast.NotBooleanExpression)
            return null;
        verification = new Ast.NotBooleanExpression(null, filter.ast);
    } else { 
        verification = filter.ast;
    }
    return new Ast.BooleanQuestionExpression(null, table, verification, table.schema!.clone());
}

function tableToStream(table : Ast.Expression, options : { monitorItemID : boolean }) : Ast.Expression|null {
    if (!table.schema!.is_monitorable)
        return null;

    let projArg : string[]|null = null;
    // remove a projection without computation, if present, and use to limit
    // which fields to monitor on
    //
    // (this means the user will monitor only the named fields, but see all
    // the fields in the notification)
    if (table instanceof Ast.ProjectionExpression && table.computations.length === 0) {
        projArg = table.args;
        table = table.expression;

        if (projArg[0] === '$event')
            return null;
    } else if (options.monitorItemID && table.schema!.is_list && table.schema!.hasArgument('id')) {
        projArg = ['id'];
    }

    let stream;
    if (table instanceof Ast.FilterExpression && !table.schema!.is_list)
        stream = new Ast.FilterExpression(null, new Ast.MonitorExpression(null, table.expression, projArg, table.expression.schema!.asType('stream')), table.filter, table.expression.schema!.asType('stream'));
    else
        stream = new Ast.MonitorExpression(null, table, projArg, table.schema!.asType('stream'));
    return stream;
}

function builtinSayAction(loader : ThingpediaLoader,
                          message ?: Ast.Value|string) : Ast.InvocationExpression|null {
    if (!loader.standardSchemas.say)
        return null;

    const selector = new Ast.DeviceSelector(null, 'org.thingpedia.builtin.thingengine.builtin', null, null);
    if (message instanceof Ast.Value) {
        const param = new Ast.InputParam(null, 'message', message);
        return new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, 'say', [param], loader.standardSchemas.say),
            loader.standardSchemas.say);
    } else if (message) {
        const param = new Ast.InputParam(null, 'message', new Ast.Value.VarRef(message));
        return new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, 'say', [param], loader.standardSchemas.say),
            loader.standardSchemas.say);
    } else {
        return new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, 'say', [], loader.standardSchemas.say),
            loader.standardSchemas.say);
    }
}

function builtinVoidAction(loader : ThingpediaLoader,
                           action : 'alert'|'timer_expire') : Ast.InvocationExpression|null {
    if (!loader.standardSchemas[action])
        return null;

    const selector = new Ast.DeviceSelector(null, 'org.thingpedia.builtin.thingengine.builtin', null, null);
    return new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, action, [], loader.standardSchemas[action]),
        loader.standardSchemas[action]);
}

function locationSubquery(loader : ThingpediaLoader,
                          loc : Ast.Value,
                          negate = false) : DomainIndependentFilterSlot|null {
    if (!loader.standardSchemas.get_gps)
        return null;

    let filter = new Ast.BooleanExpression.Atom(null, 'location', '==', loc);
    if (negate)
        filter = new Ast.BooleanExpression.Not(null, filter);

    const invocation = new Ast.Invocation(
        null,
        new Ast.DeviceSelector(null, 'org.thingpedia.builtin.thingengine.builtin', null, null),
        'get_gps',
        [],
        loader.standardSchemas.get_gps
    );
    const subquery = new Ast.FilterExpression(null, new Ast.InvocationExpression(null, invocation, invocation.schema), filter, invocation.schema);
    return { schema: null, ptype: null, ast: new Ast.BooleanExpression.ExistentialSubquery(null, subquery) };
}

function timeSubquery(loader : ThingpediaLoader,
                      low : Ast.Value|null,
                      high : Ast.Value|null) : DomainIndependentFilterSlot|null {
    if (!loader.standardSchemas.get_time)
        return null;

    const invocation = new Ast.Invocation(
        null,
        new Ast.DeviceSelector(null, 'org.thingpedia.builtin.thingengine.builtin', null, null),
        'get_time',
        [],
        loader.standardSchemas.get_time
    );
    const operands = [];
    if (low)
        operands.push(new Ast.BooleanExpression.Atom(null, 'time', '>=', low));
    if (high)
        operands.push(new Ast.BooleanExpression.Atom(null, 'time', '<=', high));
    const filter = new Ast.BooleanExpression.And(null, operands);
    const subquery = new Ast.FilterExpression(null, new Ast.InvocationExpression(null, invocation, invocation.schema), filter, invocation.schema);
    return { schema: null, ptype: null, ast: new Ast.BooleanExpression.ExistentialSubquery(null, subquery) };
}

function hasExistentialSubquery(filter : Ast.BooleanExpression) : boolean {
    if (filter instanceof Ast.AndBooleanExpression || filter instanceof Ast.OrBooleanExpression) {
        for (const op of filter.operands) {
            if (hasExistentialSubquery(op))
                return true;
        }
        return false;
    }
    if (filter instanceof Ast.NotBooleanExpression)
        return hasExistentialSubquery(filter.expr);
    return filter instanceof Ast.ExistentialSubqueryBooleanExpression;
}

function makeExistentialSubquery(proj : Ast.Expression, op : string, value : Ast.Value, negate = false) : DomainIndependentFilterSlot|null {
    if (!(proj instanceof Ast.ProjectionExpression) || proj.args.length === 0)
        return null;
    if (!(proj.expression instanceof Ast.InvocationExpression))
        return null;
    const arg = proj.args[0];
    if (arg === '$event')
        return null;
    let filter = new Ast.BooleanExpression.Atom(null, arg, op, value);
    if (negate)
        filter = new Ast.BooleanExpression.Not(null, filter);
    const selector = proj.expression.invocation.selector;
    const channel = proj.expression.invocation.channel;
    const schema = proj.expression.invocation.schema!;
    if (!schema.getArgType(arg)!.equals(value.getType()))
        return null;

    const invocation = new Ast.Invocation(null, selector, channel, [], schema);
    const subquery = new Ast.FilterExpression(
        null,
        new Ast.InvocationExpression(null, invocation, schema),
        filter,
        schema
    );
    return { schema: null, ptype: null, ast: new Ast.BooleanExpression.ExistentialSubquery(null, subquery) };
}

export function resolveChain(expressions : Ast.Expression[]) : Ast.FunctionDef {
    // the schema of a chain is just the schema of the last function in
    // the chain, nothing special about it - no joins, no merging, no
    // nothing
    const last = expressions[expressions.length-1];

    // except the schema is monitorable if the _every_ schema is monitorable
    // and the schema is a list if _any_ schema is a list
    const clone = last.schema!.clone();
    clone.is_list = expressions.some((exp) => exp.schema!.is_list);
    clone.is_monitorable = expressions.every((exp) => exp.schema!.is_monitorable);

    return clone;
}

export function makeChainExpression(first : Ast.Expression, second : Ast.Expression) {
    // flatten chains and compute the schema
    const expressions : Ast.Expression[] = [];
    if (first instanceof Ast.ChainExpression)
        expressions.push(...first.expressions);
    else
        expressions.push(first);
    if (second instanceof Ast.ChainExpression)
        expressions.push(...second.expressions);
    else
        expressions.push(second);

    return new Ast.ChainExpression(null, expressions, resolveChain(expressions));
}

export function addParameterPassing(first : Ast.Expression,
                                    second : ExpressionWithCoreference) : Ast.ChainExpression|null {
    // no self-joins
    if (isSameFunction(first.schema!, second.expression.schema!))
        return null;

    if (second.slot !== null) {
        // specific parameter passing
        if (!isSameFunction(second.slot.schema, first.schema!))
            return null;

        // all we need to do is to check compatibility, the rest follows
        // (we need to check both function and type in case of projections/aggregations
        // or in case the parameter is a nested parameter of a compound type
        const lhsType = first.schema!.getArgType(second.slot.name);
        if (!lhsType || !lhsType.equals(second.type))
            return null;

        return makeChainExpression(first, second.expression);
    } else {
        // implicit parameter passing, or param passing by projection
        assert(second.pname);

        let lhsName, lhsType;
        let table = first;
        if (table instanceof Ast.MonitorExpression)
            table = table.expression;
        if (table instanceof Ast.ProjectionExpression) {
            const args = getProjectionArguments(table);
            assert(args.length > 0);
            if (args.length > 1)
                return null;
            lhsName = args[0];
            lhsType = table.schema!.getArgType(lhsName);
        } else {
            lhsName = getImplicitParameterPassing(table.schema!);
            if (lhsName === '$event')
                lhsType = Type.String;
            else
                lhsType = table.schema!.getArgType(lhsName);
        }
        assert(lhsType);
        if (!lhsType.equals(second.type))
            return null;
        const joinArg = lhsName === '$event' ? new Ast.Value.Event(null) : new Ast.Value.VarRef(lhsName);

        const reduced = betaReduceMany(second.expression, { [second.pname]: joinArg });
        if (reduced === null)
            return null;
        return makeChainExpression(first, reduced);
    }
}

export function addSameNameParameterPassing(loader : ThingpediaLoader,
                                            chain : Ast.ChainExpression,
                                            joinArg : ParamSlot) : Ast.ChainExpression|null {
    const action = chain.last;
    assert(action instanceof Ast.InvocationExpression);
    const table = chain.lastQuery!;
    if (!isSameFunction(action.schema!, joinArg.schema))
        return null;
    // prevent self-joins
    if (isSameFunction(action.schema!, table.schema!))
        return null;

    const actionarg = action.schema!.getArgument(joinArg.name);
    if (!actionarg || !actionarg.is_input)
        return null;
    const actiontype = actionarg.type;
    if (action.invocation.in_params.some((p) => p.name === joinArg.name))
        return null;
    const commandtype = table.schema!.getArgType(joinArg.name);
    if (!commandtype || !Type.isAssignable(commandtype, actiontype, {}, loader.entitySubTypeMap))
        return null;
    // FIXME
    //if (joinArg.isEvent && (stream instanceof Ast.FunctionCallExpression)) // timer
    //    return null;

    const clone = action.clone();
    clone.invocation.in_params.push(new Ast.InputParam(null, joinArg.name, new Ast.Value.VarRef(joinArg.name)));

    const newExpressions = chain.expressions.slice(0, chain.expressions.length-1);
    newExpressions.push(clone);
    return new Ast.ChainExpression(null, newExpressions, resolveChain(newExpressions));
}

function isConstantAssignable(loader : ThingpediaLoader,
                              value : Ast.Value,
                              ptype : Type) : boolean {
    if (!ptype)
        return false;
    const vtype = value.getType();
    if (!Type.isAssignable(vtype, ptype, {}, loader.entitySubTypeMap))
        return false;
    // prevent mixing date and type (ThingTalk allows it to support certain time get predicates)
    if ((vtype.isDate && ptype.isTime) || (vtype.isTime && ptype.isDate))
        return false;
    if (value instanceof Ast.EnumValue && (!(ptype instanceof Type.Enum) || ptype.entries!.indexOf(value.value) < 0))
        return false;
    return true;
}

export function replacePlaceholderWithUndefined<T extends Ast.Expression|Ast.Invocation>(lhs : T, param : string) : T|null {
    return betaReduceMany(lhs, { [param]: new Ast.Value.Undefined(true) });
}

function sayProjection(loader : ThingpediaLoader,
                       maybeProj : Ast.Expression|null) : Ast.Expression|null {
    if (maybeProj === null)
        return null;

    // this function is also used for aggregation
    if (maybeProj instanceof Ast.ProjectionExpression) {
        const proj : Ast.ProjectionExpression = maybeProj;
        assert(proj.args.length > 0 || proj.computations.length > 0);
        if (proj.args.length === 1 && proj.args[0] === 'picture_url')
            return null;
        if (proj.args.length === 1 && proj.args[0] === '$event')
            return null;
        // if the function only contains one parameter, do not generate projection for it
        if (proj.computations.length === 0 && countInputOutputParams(proj.expression.schema!).output === 1)
            return null;
        if (!loader.flags.projection)
            return null;

        // remove all projection args that are part of the minimal projection
        const newArgs = proj.args.filter((a) => !proj.expression.schema!.minimal_projection!.includes(a));
        // note: the schema does not change! that's the whole point of minimal projection
        if (newArgs.length === 0 && proj.computations.length === 0) {
            maybeProj = proj.expression;
        } else {
            newArgs.sort();
            maybeProj.args = newArgs;
        }
    }
    return maybeProj;
}

function hasConflictParam(table : Ast.Expression, pname : string, operation : string) : string|null {
    function cleanName(name : string) : string {
        if (name.endsWith(' value'))
            name = name.substring(0, name.length - ' value'.length);
        if (name.includes('.')) {
            const components = name.split('.');
            name = components[components.length - 1];
        }
        return name;

    }
    const pcleaned = cleanName(pname);
    for (const arg of table.schema!.iterateArguments()) {
        if (arg.is_input || !arg.type.isNumber)
            continue;
        if (cleanName(arg.canonical) === `${pcleaned} ${operation}`)
            return arg.name;
    }
    return null;
}

function maybeGetIdFilter(subquery : Ast.Expression) : Ast.Value|undefined {
    for (const [, filter] of iterateFilters(subquery)) {
        for (const atom of iterateFields(filter)) {
            if (atom instanceof Ast.AtomBooleanExpression && atom.name === 'id')
                return atom.value;
        }
    }
    return undefined;
}

/**
 * Find the argument in table2 that matches the id of table1
 */
function findMatchingArgument(table1 : Ast.Expression,
                              table2 : Ast.Expression,
                              pname : string|null) : Ast.ArgumentDef|null {
    const idType = table1.schema!.getArgType('id');
    if (!idType || !idType.isEntity)
        return null;

    let match = undefined;
    if (pname) {
        match = table2.schema!.getArgument(pname);
        if (!match)
            return null;
        if (!(match.type.equals(idType) ||
            (match.type instanceof Type.Array && (match.type.elem as Type).equals(idType))))
            return null;

    } else {
        for (const arg of table2.schema!.iterateArguments()) {
            if (arg.type.equals(idType) ||
                (arg.type instanceof Type.Array && (arg.type.elem as Type).equals(idType))) {
                // in case multiple matches found and no pname specified, return null
                if (match)
                    return null;
                match = arg;
            }
        }
        if (!match)
            return null;
    }
    if (match.name === 'id')
        return null;

    return match;
}

// comparison subquery where the projection of subquery is on id
// e.g., table filter pname == ([id] of subquery)
function addComparisonSubquery(table : Ast.Expression,
                               subquery : Ast.Expression,
                               pname : string|null,
                               negate = false) : Ast.Expression|null {
    const lhsArg = findMatchingArgument(subquery, table, pname);
    if (!lhsArg)
        return null;

    // in case where subquery already has a filter on id, replace the subquery with a simple atom filter
    const idFilter = maybeGetIdFilter(subquery);
    if (idFilter) {
        if (idFilter.isString)
            return null;

        let newAtom = new Ast.BooleanExpression.Atom(null, lhsArg.name,
            lhsArg.type.isArray ? 'contains': '==', idFilter);
        if (negate)
            newAtom = new Ast.BooleanExpression.Not(null, newAtom);

        return addFilterInternal(table, newAtom, {});
    }

    // add id projection to subquery
    let expr = subquery;
    while (expr instanceof Ast.ProjectionExpression)
        expr = expr.expression;
    subquery = new Ast.ProjectionExpression(null, expr, ['id'], [], [], subquery.schema);

    const comparisonSubquery = new Ast.BooleanExpression.ComparisonSubquery(
        null,
        new Ast.Value.VarRef(lhsArg.name),
        lhsArg.type.isArray ? 'contains' : '==',
        subquery,
        null
    );
    const filter = negate ? new Ast.BooleanExpression.Not(null, comparisonSubquery) : comparisonSubquery;
    return addFilterInternal(table, filter, {});
}

// comparison subquery where the lhs is the id of the main table
// e.g., table filter id == ([pname] of subquery)
function addReverseComparisonSubquery(table : Ast.Expression,
                                      subquery : Ast.Expression,
                                      pname : string|null, negate = false) : Ast.Expression|null {
    const projection = findMatchingArgument(table, subquery, pname);
    if (!projection)
        return null;

    // add id projection to subquery
    let expr = subquery;
    while (expr instanceof Ast.ProjectionExpression)
        expr = expr.expression;
    // no projection if there is only one output parameter
    if (countInputOutputParams(expr.schema!).output === 1)
        return null;
    subquery = new Ast.ProjectionExpression(null, expr, [projection.name], [], [], subquery.schema);

    const comparisonSubquery = new Ast.BooleanExpression.ComparisonSubquery(
        null,
        new Ast.Value.VarRef('id'),
        projection.type.isArray ? 'in_array' : '==',
        subquery,
        null
    );
    const filter = negate ? new Ast.BooleanExpression.Not(null, comparisonSubquery) : comparisonSubquery;
    return addFilterInternal(table, filter, {});
}


function makeComputeExpression(table : Ast.Expression,
                               operation : string,
                               operands : Ast.Value[],
                               resultType : Type) : Ast.Expression {
    const expression = new Ast.Value.Computation(operation, operands, null, resultType);
    if (operation === 'distance')
        expression.overload = [Type.Location, Type.Location, resultType];

    return new Ast.ProjectionExpression(null, table, [], [expression], [null], resolveProjection(table.schema!, [], [expression]));
}

function makeComputeFilterExpression(loader : ThingpediaLoader,
                                     table : Ast.Expression,
                                     operation : 'distance',
                                     operands : Ast.Value[],
                                     resultType : Type,
                                     filterOp : string,
                                     filterValue : Ast.Value) : Ast.Expression|null {
    // do not compute on a computed table
    if (table instanceof Ast.ProjectionExpression && table.computations.length > 0)
        return null;

    const expression = new Ast.Value.Computation(operation, operands);
    if (operation === 'distance') {
        expression.overload = [Type.Location, Type.Location, new Type.Measure('m')];
        expression.type = new Type.Measure('m');
    }
    const filter = {
        schema: null,
        ptype: expression.type,
        ast: new Ast.BooleanExpression.Compute(null, expression, filterOp, filterValue)
    };
    return addFilter(loader, table, filter);
}

function makeWithinGeoDistanceExpression(loader : ThingpediaLoader, table : Ast.Expression, location : Ast.Value, filterValue : Ast.Value) : Ast.Expression|null {
    const arg = table.schema!.getArgument('geo');
    if (!arg || !arg.type.isLocation)
        return null;
    if (!(filterValue instanceof Ast.Value.Measure))
        return null;
    const unit = filterValue.unit;
    assert(unit);
    if (Units.normalizeUnit(unit) !== 'm')
        return null;
    // the unit should be at least feet
    if (Units.transformToBaseUnit(1, unit) < Units.transformToBaseUnit(1, 'ft'))
        return null;
    // the distance should be at least 100 meters (if the value is small number)
    if (filterValue instanceof Ast.MeasureValue && Units.transformToBaseUnit(filterValue.value, unit) < 100)
        return null;
    return makeComputeFilterExpression(loader, table, 'distance', [new Ast.Value.VarRef('geo'), location], new Type.Measure('m'), '<=', filterValue);
}

function makeComputeArgMinMaxExpression(table : Ast.Expression,
                                        operation : string,
                                        operands : Ast.Value[],
                                        resultType : Type,
                                        direction : 'asc'|'desc' = 'desc') : Ast.Expression|null {
    if (hasUniqueFilter(table))
        return null;
    for (const [, filter] of iterateFilters(table)) {
        for (const atom of iterateFields(filter)) {
            if ('name' in atom && atom.name === (operands[0] as Ast.VarRefValue).name)
                return null;
            if ('lhs' in atom && atom.lhs instanceof Ast.VarRefValue && atom.lhs.name ===  (operands[0] as Ast.VarRefValue).name)
                return null;
        }
    }
    const expression = new Ast.Value.Computation(operation, operands, null, resultType);
    if (operation === 'distance')
        expression.overload = [Type.Location, Type.Location, resultType];
    const sort = new Ast.SortExpression(null, table, expression, direction, table.schema);
    return new Ast.IndexExpression(null, sort, [new Ast.Value.Number(1)], table.schema);
}

function makeAggComputeValue(table : Ast.Expression,
                             operation : string,
                             field : string|null,
                             slot : ParamSlot|FilterValueSlot,
                             resultType : Type) : Ast.Value|null {
    if (!isSameFunction(table.schema!, slot.schema))
        return null;
    if (hasUniqueFilter(table))
        return null;
    const list = slot.ast;
    if (list instanceof Ast.VarRefValue) {
        const name = list.name;
        assert(typeof name === 'string');
        const canonical = table.schema!.getArgCanonical(name)!;
        for (const p of table.schema!.iterateArguments()) {
            if (p.name === name + 'Count' || p.canonical === canonical + 'count' || p.canonical === canonical.slice(0,-1) + ' count')
                return new Ast.Value.VarRef(p.name);
        }
    }
    const expression = new Ast.Value.Computation(operation, [field ? new Ast.Value.ArrayField(list, field) : list]);
    if (operation === 'count') {
        expression.overload = [new Type.Array('x'), Type.Number];
        expression.type = Type.Number;
    } else {
        expression.overload = [new Type.Array(resultType), resultType];
        expression.type = resultType;
    }
    return expression;
}

function makeAggComputeExpression(table : Ast.Expression,
                                  operation : string,
                                  field : string|null,
                                  list : ParamSlot|FilterValueSlot,
                                  resultType : Type) : Ast.Expression|null {
    const value = makeAggComputeValue(table, operation, field, list, resultType);
    if (!value)
        return null;
    if (value instanceof Ast.Value.VarRef)
        return new Ast.ProjectionExpression(null, table, [value.name], [], [], resolveProjection(table.schema!, [value.name]));
    else
        return new Ast.ProjectionExpression(null, table, [], [value], [null], resolveProjection(table.schema!, [], [value]));
}

function makeAggComputeArgMinMaxExpression(table : Ast.Expression,
                                           operation : string,
                                           field : string|null,
                                           list : ParamSlot|FilterValueSlot,
                                           resultType : Type,
                                           direction : 'asc'|'desc' = 'desc') : Ast.Expression|null {
    const value = makeAggComputeValue(table, operation, field, list, resultType);
    if (!value)
        return null;
    const sort = new Ast.SortExpression(null, table, value, direction, table.schema);
    return new Ast.IndexExpression(null, sort, [new Ast.Value.Number(1)], table.schema);

}

function hasArgumentOfType(invocation : Ast.Invocation, type : Type) : boolean {
    for (const arg of invocation.schema!.iterateArguments()) {
        if (!arg.is_input)
            continue;
        if (arg.type.equals(type))
            return true;
    }
    return false;
}

class UsesParamVisitor extends Ast.NodeVisitor {
    used = false;
    constructor(private pname : string) {
        super();
    }

    visitExternalBooleanExpression() {
        // do not recurse
        return false;
    }
    visitValue() {
        // do not recurse
        return false;
    }

    visitAtomBooleanExpression(atom : Ast.AtomBooleanExpression) {
        this.used = this.used || this.pname === atom.name;
        return true;
    }
}

function filterUsesParam(filter : Ast.BooleanExpression, pname : string) : boolean {
    const visitor = new UsesParamVisitor(pname);
    filter.visit(visitor);
    return visitor.used;
}

interface AddInputParamsOptions {
    allowOutput ?: boolean;
}

function checkInvocationInputParam(loader : ThingpediaLoader,
                                   invocation : Ast.Invocation,
                                   param : InputParamSlot,
                                   options : AddInputParamsOptions = {}) : boolean {
    assert(invocation instanceof Ast.Invocation);
    const arg = invocation.schema!.getArgument(param.ast.name);
    if (!arg || (!arg.is_input && !options.allowOutput) || !isConstantAssignable(loader, param.ast.value, arg.type))
        return false;
    if (!isSameFunction(invocation.schema!, param.schema))
        return false;

    if (arg.type.isNumber || arg.type.isMeasure) {
        // __const varref, likely
        if (!param.ast.value.isNumber && !param.ast.value.isMeasure)
            return false;

        let min = -Infinity;
        const minArg = arg.getImplementationAnnotation<number>('min_number');
        if (minArg !== undefined)
            min = minArg;
        const maxArg = arg.getImplementationAnnotation<number>('max_number');
        let max = Infinity;
        if (maxArg !== undefined)
            max = maxArg;

        const value = param.ast.value.toJS() as number;
        if (value < min || value > max)
            return false;
    }

    return true;
}

function addInvocationInputParam(loader : ThingpediaLoader,
                                 invocation : Ast.Invocation,
                                 param : InputParamSlot,
                                 options ?: AddInputParamsOptions) : Ast.Invocation|null {
    if (!checkInvocationInputParam(loader, invocation, param, options))
        return null;

    const clone = invocation.clone();
    for (const existing of clone.in_params) {
        if (existing.name === param.ast.name) {
            if (existing.value.isUndefined) {
                existing.value = param.ast.value;
                return clone;
            } else {
                return null;
            }
        }
    }
    clone.in_params.push(param.ast);
    return clone;
}

function addActionInputParam(loader : ThingpediaLoader,
                             action : Ast.Expression,
                             param : InputParamSlot,
                             options ?: AddInputParamsOptions) : Ast.Expression|null {
    if (action instanceof Ast.ChainExpression) {
        const added = addActionInputParam(loader, action.last, param, options);
        if (!added)
            return null;
        const clone = new Ast.ChainExpression(null, action.expressions.slice(0, action.expressions.length-1).concat([added]), added.schema!);
        return clone;
    }
    if (!(action instanceof Ast.InvocationExpression))
        return null;
    const newInvocation = addInvocationInputParam(loader, action.invocation, param, options);
    if (newInvocation === null)
        return null;

    return new Ast.InvocationExpression(null, newInvocation, action.schema!);
}

/**
 * Find the filter expression in the context.
 *
 * Returns filter expression
 */
function findFilterExpression(root : Ast.Expression) : Ast.FilterExpression|null {
    let expr = root;
    while (!(expr instanceof Ast.FilterExpression)) {
        // do not touch these with filters
        if (expr instanceof Ast.AggregationExpression ||
            expr instanceof Ast.FunctionCallExpression ||
            expr instanceof Ast.JoinExpression)
            return null;

        // go inside these
        if (expr instanceof Ast.SortExpression ||
            expr instanceof Ast.MonitorExpression ||
            expr instanceof Ast.IndexExpression ||
            expr instanceof Ast.SliceExpression ||
            expr instanceof Ast.ProjectionExpression ||
            expr instanceof Ast.AliasExpression ||
            expr instanceof Ast.BooleanQuestionExpression) {
            expr = expr.expression;
            continue;
        }

        if (expr instanceof Ast.ChainExpression) {
            // go right on join, always, but don't cross into the action
            const maybeExpr = expr.lastQuery;
            if (!maybeExpr)
                return null;
            expr = maybeExpr;
            continue;
        }

        assert(expr instanceof Ast.InvocationExpression);
        // if we get here, there is no filter table at all
        return null;
    }

    return expr;
}

class GetInvocationVisitor extends Ast.NodeVisitor {
    invocation : Ast.Invocation|Ast.FunctionCallExpression|undefined = undefined;

    visitFunctionCallExpression(inv : Ast.FunctionCallExpression) : boolean {
        // keep overwriting so we store the last invocation in traversal order
        // which is also the last invocation in program order
        this.invocation = inv;
        return false; // no need to recurse
    }

    visitInvocation(inv : Ast.Invocation) : boolean {
        // keep overwriting so we store the last invocation in traversal order
        // which is also the last invocation in program order
        this.invocation = inv;
        return false; // no need to recurse
    }
}

function getInvocation(historyItem : Ast.Node) : Ast.Invocation|Ast.FunctionCallExpression {
    assert(historyItem instanceof Ast.Node);

    const visitor = new GetInvocationVisitor();
    historyItem.visit(visitor);
    assert(visitor.invocation);
    return visitor.invocation;
}

class AdjustDefaultParametersVisitor extends Ast.NodeVisitor {
    visitInvocation(invocation : Ast.Invocation) : boolean {
        invocation.in_params = invocation.in_params.filter((ip) => {
            const arg = invocation.schema!.getArgument(ip.name);
            assert(arg && arg.is_input);
            const _default = arg.impl_annotations.default;
            if (_default && ip.value.equals(_default))
                return false;
            return true;
        });
        return false;
    }
}

function adjustDefaultParameters<T extends Ast.Node>(stmt : T) : T {
    stmt.visit(new AdjustDefaultParametersVisitor());
    return stmt;
}

export function expressionUsesIDFilter(expr : Ast.Expression) {
    const filterExpression = findFilterExpression(expr);
    if (!filterExpression)
        return false;

    return filterUsesParam(filterExpression.filter, 'id');
}

function isDurationRelativeDate(value : Ast.Value) {
    if (!(value instanceof Ast.ComputationValue && value.op === '+'))
        return false;
    const operand = value.operands[0];
    return operand instanceof Ast.DateValue && operand.value === null;
}

/**
 * Decide if a ThingTalk timer expression should be logically treated like an
 * "alarm" (beeps, gives you current time) or a "timer" (beeps in a different way,
 * gives you delta time from start)
 *
 * @param timer the ThingTalk timer expression
 * @returns the Thingpedia function to use for the action with this timer
 */
function isTimerOrAlarm(timer : Ast.FunctionCallExpression) : 'alert'|'timer_expire' {
    if (timer.name === 'timer')
        return 'timer_expire';
    if (timer.name === 'attimer')
        return 'alert';

    assert(timer.name === 'ontimer');
    assert(timer.in_params.length === 1);
    const date = timer.in_params[0].value;
    assert(date instanceof Ast.ArrayValue);

    if (date.value.every(isDurationRelativeDate))
        return 'timer_expire';
    else
        return 'alert';
}

export function makeReminder(loader : ThingpediaLoader, timer : Ast.FunctionCallExpression, message ?: Ast.Value) {
    const action = builtinSayAction(loader, message);
    if (!action)
        return null;
    return makeChainExpression(timer, action);
}

export function makeDateReminder(loader : ThingpediaLoader, date : Ast.Value, message ?: Ast.Value) {
    const timer = makeDateTimer(loader, date);
    if (timer === null)
        return null;
    return makeReminder(loader, timer, message);
}

export function makeDurationReminder(loader : ThingpediaLoader, duration : Ast.Value, message ?: Ast.Value) {
    const date = makeDate(null, '+', duration);
    if (date === null)
        return null;
    return makeDateReminder(loader, date, message);
}

export function makeAlarm(loader : ThingpediaLoader, timer : Ast.FunctionCallExpression) {
    const action = builtinVoidAction(loader, isTimerOrAlarm(timer));
    if (!action)
        return null;
    return makeChainExpression(timer, action);
}

export function makeDateAlarm(loader : ThingpediaLoader, date : Ast.Value) {
    const timer = makeDateTimer(loader, date);
    if (timer === null)
        return null;
    return makeAlarm(loader, timer);
}

export function makeDurationAlarm(loader : ThingpediaLoader, duration : Ast.Value) {
    const date = makeDate(null, '+', duration);
    if (date === null)
        return null;
    return makeDateAlarm(loader, date);
}

export function makeFrequencyTimer(loader : ThingpediaLoader, frequency : Ast.Value, unit : 'ms'|'s'|'min'|'h'|'day'|'week'|'mon'|'year') {
    const params = [
        new Ast.InputParam(null, 'interval', new Ast.Value.Measure(1, unit)),
        new Ast.InputParam(null, 'frequency', frequency)
    ];
    return new Ast.FunctionCallExpression(null, 'timer', params, loader.standardSchemas.timer);
}

export function makeIntervalTimer(loader : ThingpediaLoader, unit : 'ms'|'s'|'min'|'h'|'day'|'week'|'mon'|'year') {
    const params = [
        new Ast.InputParam(null, 'interval', new Ast.Value.Measure(1, unit)),
    ];
    return new Ast.FunctionCallExpression(null, 'timer', params, loader.standardSchemas.timer);
}

export function makeRepeatingTimeTimer(loader : ThingpediaLoader, times : Ast.Value[]) {
    const params = [
        new Ast.InputParam(null, 'time', new Ast.Value.Array(times)),
    ];
    return new Ast.FunctionCallExpression(null, 'attimer', params, loader.standardSchemas.attimer);
}

function isNegativeDate(value : Ast.Value) {
    if (value instanceof Ast.ComputationValue && value.op === '-')
        return true;

    if (value instanceof Ast.DateValue &&
        value.value instanceof Ast.DateEdge &&
        value.value.edge === 'start_of')
        return true;

    return false;
}

export function makeDateTimer(loader : ThingpediaLoader, date : Ast.Value) {
    if (isNegativeDate(date))
        return null;
    const params = [
        new Ast.InputParam(null, 'date', new Ast.Value.Array([date]))
    ];
    return new Ast.FunctionCallExpression(null, 'ontimer', params, loader.standardSchemas.ontimer);
}

function makeJoinExpressionHelper(join : Ast.JoinExpression, condition : FilterSlot, projection = ['first.id', 'second.id']) {
    const filtered = new Ast.FilterExpression(null, join, condition.ast, join.schema);
    return new Ast.ProjectionExpression(null, filtered, projection, [], [], resolveProjection(filtered.schema!, projection));
}

function makeSelfJoin(table : Ast.Expression, condition : FilterSlot) {
    assert(table.schema);
    if (condition.schema !== null && !isSameFunction(table.schema!, condition.schema))
        return null;
    const join = new Ast.JoinExpression(null, table, table.clone(), resolveJoin(table.schema, table.schema));
    return makeJoinExpressionHelper(join, condition);
}

function makeSelfJoinFromParam(tpLoader : ThingpediaLoader, table : Ast.Expression, param : ParamSlot) {
    // the join condition has to be between a non-id parameter and id
    if (param.name === 'id')
        return null;
    assert(table.schema);
    if (!table.schema.hasArgument(param.name))
        return null;

    const schema = resolveJoin(table.schema, table.schema);
    const joinParam = Object.assign({}, param);
    joinParam.name = `first.${param.name}`;
    joinParam.schema = schema;
    const op = joinParam.type.isArray ? 'contains' : '==';
    const condition = makeFilter(tpLoader, joinParam, op, new Ast.VarRefValue('second.id', schema.getArgType('second.id')));
    if (!condition)
        return null;
    const join = new Ast.JoinExpression(null, table, table.clone(), resolveJoin(table.schema, table.schema));
    return makeJoinExpressionHelper(join, condition);
}

function makeGenericJoin(tpLoader : ThingpediaLoader,
                         lhs : Ast.Expression, lhsParam : ParamSlot,
                         rhs : Ast.Expression, rhsParam : ParamSlot) {
    // the join condition has to be between a non-id parameter and id
    if (lhsParam.name === 'id')
        return null;
    // if the projection on the rhs table is simply id, we don't need join
    if (rhsParam.name === 'id')
        return null;
    assert(lhs.schema && rhs.schema);
    if (!lhs.schema.hasArgument(lhsParam.name) || !lhs.schema.hasArgument('id') || !rhs.schema.hasArgument(rhsParam.name))
        return null;
    const schema = resolveJoin(lhs.schema, rhs.schema);
    const joinParam = Object.assign({}, lhsParam);
    joinParam.name = `first.${lhsParam.name}`;
    joinParam.schema = schema;
    const op = joinParam.type.isArray ? 'contains' : '==';
    const condition = makeFilter(tpLoader, joinParam, op, new Ast.VarRefValue('second.id', schema.getArgType('second.id')));
    if (!condition)
        return null;
    const join =  new Ast.JoinExpression(null, lhs, rhs, schema);
    return makeJoinExpressionHelper(join, condition, ['first.id', `second.${rhsParam.name}`]);
}

export function whenDoRule(table : Ast.Expression, action : ExpressionWithCoreference, options : { monitorItemID : boolean }) {
    const stream = tableToStream(table, { monitorItemID: false });
    if (!stream)
        return null;
    return addParameterPassing(stream, action);
}

function makeWikidataTimeFilter(qualifier : { pname : string, pslot : ParamSlot } , op : string, constants : Ast.Value[]) : FilterSlot|null {
    assert(constants.length === 1 || constants.length === 2);
    const ptype = qualifier.pslot.schema.getArgType(qualifier.pname);
    if (!(ptype instanceof Type.Array) || !(ptype.elem instanceof Type.Compound))
        return null;
    if (constants.length === 1) {
        // date point
        const filter = new Ast.BooleanExpression.Atom(null, qualifier.pslot.name, op, constants[0]);
        return {
            schema: qualifier.pslot.schema,
            ptype,
            ast: filter
        };
    } else if (op === '==' && (qualifier.pslot.name === 'start_time' || qualifier.pslot.name === 'end_time')) {
        // date range with start_time & end_time
        if (!('start_time' in ptype.elem.fields && 'end_time' in ptype.elem.fields))
            return null;
        const filter = new Ast.BooleanExpression.Or(null, [
            new Ast.BooleanExpression.Atom(null, 'start_time', '>=', constants[1]),
            new Ast.BooleanExpression.Atom(null, 'end_time', '<=', constants[0])
        ]);
        return { schema: qualifier.pslot.schema, ptype, ast: filter };
    } else if (op === '==' && qualifier.pslot.name === 'point_in_time') {
        // date range with point_in_time
        const filter = new Ast.BooleanExpression.And(null, [
            new Ast.BooleanExpression.Atom(null, 'point_in_time', '>=', constants[0]),
            new Ast.BooleanExpression.Atom(null, 'point_in_time', '<=', constants[1])
        ]);
        return { schema: qualifier.pslot.schema, ptype, ast: filter };
    }
    return null;
}

function makeQualifiedFilter(filter : FilterSlot, qualifier : FilterSlot) : FilterSlot|null {
    if (!(filter.ptype instanceof Type.Array && filter.ptype.elem instanceof Type.Compound))
        return null;
    for (const atom of iterateFields(qualifier.ast)) {
        let field;
        if (atom instanceof Ast.AtomBooleanExpression)
            field = atom.name;
        else if (atom instanceof Ast.ComparisonSubqueryBooleanExpression)
            field = (atom.lhs as Ast.VarRefValue).name;
        if (!field)
            return null;
        if (!(field in filter.ptype.elem.fields))
            return null;
    }
    const ast = filter.ast instanceof Ast.NotBooleanExpression ? filter.ast.expr : filter.ast;
    if (!(ast instanceof Ast.AtomBooleanExpression))
        return null;
    let qualifiedFilter = new Ast.BooleanExpression.Compute(
        null,
        new Ast.FilterValue(new Ast.Value.VarRef(ast.name), qualifier.ast),
        ast.operator,
        ast.value
    );
    if (filter.ast instanceof Ast.NotBooleanExpression)
        qualifiedFilter = new Ast.NotBooleanExpression(null, qualifiedFilter);
    return { 
        schema:filter.schema, 
        ptype: filter.ptype, 
        ast: qualifiedFilter 
    };
}


export {
    // helpers
    typeToStringSafe,
    isSameFunction,
    hasArgumentOfType,
    isConstantAssignable,
    filterUsesParam,
    getFunctionNames,
    getFunctions,
    getInvocation,
    adjustDefaultParameters,
    hasConflictParam,

    // constants
    addUnit,
    makeDate,
    makeMonthDateRange,
    makeDateWithDateTime,

    // builtins
    builtinSayAction,
    locationSubquery,
    timeSubquery,

    makeProgram,
    combineStreamCommand,

    // input parameters
    checkInvocationInputParam,
    addInvocationInputParam,
    addActionInputParam,

    // filters
    hasUniqueFilter,
    makeOrFilter,
    makeButFilter,
    makeAggregateFilter,
    makeAggregateFilterWithFilter,
    checkFilter,
    addFilter,
    findFilterExpression,

    // wikidata qualifiers
    makeWikidataTimeFilter,
    makeQualifiedFilter,

    // subquery
    hasExistentialSubquery,
    makeExistentialSubquery,
    addComparisonSubquery,
    addReverseComparisonSubquery,

    makeListExpression,
    makeSortedTable,
    makeArgMaxMinTable,
    checkValidQuery,

    // projections
    resolveProjection,
    makeProjection,
    makeSingleFieldProjection,
    makeMultiFieldProjection,
    sayProjection,
    makeVerificationQuestion,

    // joins
    makeSelfJoin,
    makeSelfJoinFromParam,
    makeGenericJoin,

    // streams
    makeEdgeFilterStream,
    tableToStream,

    // compute expressions
    makeComputeExpression,
    makeComputeFilterExpression,
    makeComputeArgMinMaxExpression,
    makeAggComputeExpression,
    makeAggComputeArgMinMaxExpression,

    makeWithinGeoDistanceExpression,

    iterateFilters,
    iterateFields,
};
