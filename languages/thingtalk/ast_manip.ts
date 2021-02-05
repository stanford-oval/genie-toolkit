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

function makeDate(base : Ast.Value|Date|Ast.DateEdge|Ast.DatePiece|Ast.WeekDayDate|null, operator : '+'|'-', offset : Ast.Value|null) : Ast.Value {
    if (!(base instanceof Ast.Value))
        base = new Ast.Value.Date(base);
    if (offset === null)
        return base;

    const value = new Ast.Value.Computation(operator, [base, offset],
        [Type.Date, new Type.Measure('ms'), Type.Date], Type.Date);
    return value;
}

export function fixTwoYearNumber(year : number) {
    if (year >= 50)
        return 1900 + year;
    else
        return 2000 + year;
}

export function dateOrDatePiece(year : number|null, month : number|null) : Date|Ast.DatePiece {
    if (year === null)
        return new Ast.DatePiece(year, month, null, null);
    else
        return new Date(fixTwoYearNumber(year), month === null ? 0 : month - 1);
}

function makeMonthDateRange(year : number|null, month : number|null) : [Ast.Value, Ast.Value] {
    return [
        makeDate(dateOrDatePiece(year, month), '+', null),
        makeDate(dateOrDatePiece(year, month), '+', new Ast.Value.Measure(1, 'mon'))
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
    if (!checkFilter(proj.expression, f))
        return null;
    if (!proj.schema!.is_monitorable || proj.schema!.is_list)
        return null;
    const outParams = Object.keys(proj.expression.schema!.out);
    if (outParams.length === 1 && loader.flags.turking)
        return null;

    return new Ast.FilterExpression(null, new Ast.MonitorExpression(null, proj.expression, null, proj.expression.schema), f.ast, proj.expression.schema);
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
        if (!arg || arg.is_input)
            throw new TypeError('Invalid field name ' + argname);
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
    const outParams = Object.keys(schema.out);
    if (outParams.length === 1)
        return outParams[0];

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

    return makeProjection(new Ast.MonitorExpression(null, table, null, table.schema), pname);
}

function isEqualityFilteredOnParameter(table : Ast.Expression, pname : string) : boolean {
    for (const [,filter] of iterateFilters(table)) {
        for (const field of iterateFields(filter)) {
            if (field.name === pname && field instanceof Ast.AtomBooleanExpression &&
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

    const outParams = Object.keys(table.schema!.out);
    if (outParams.length === 1)
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
        const stream = new Ast.MonitorExpression(null, table, null, table.schema);
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
        const stream = new Ast.MonitorExpression(null, table, null, table.schema);
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

    const type = table.schema!.out[pname];
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
            if (atom.name === pname)
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
    if (!checkValidQuery(rule))
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
        const outParams = Object.keys(table.expression.schema!.out);
        if (outParams.length === 1)
            return null;
    }
    if (isSameFunction(stream.schema!, table.schema!))
        return null;
    return new Ast.ChainExpression(null, [stream, table], table.schema);
}

function checkComputeFilter(table : Ast.Expression, filter : Ast.ComputeBooleanExpression) : boolean {
    if (!(filter.lhs instanceof Ast.ComputationValue))
        return false;

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

    if (!table.schema!.out[param.name])
        return false;

    let vtype, ftype;
    const ptype = table.schema!.out[param.name];
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

function checkAtomFilter(table : Ast.Expression, filter : Ast.AtomBooleanExpression) : boolean {
    const arg = table.schema!.getArgument(filter.name);
    if (!arg || arg.is_input)
        return false;

    if (arg.getAnnotation('filterable') === false)
        return false;

    const ptype = table.schema!.out[filter.name];
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
    for (const type of vtypes) {
        if (filter.value.getType().equals(type))
            typeMatch = true;
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
            if (value < min || value > max)
                return false;
        }
    }
    return true;
}

function internalCheckFilter(table : Ast.Expression, filter : Ast.BooleanExpression) : boolean {
    while (table instanceof Ast.ProjectionExpression)
        table = table.expression;

    if (filter instanceof Ast.NotBooleanExpression)
        filter = filter.expr;
    if (filter instanceof Ast.ExternalBooleanExpression) // FIXME
        return true;
    if (filter instanceof Ast.AndBooleanExpression ||
        filter instanceof Ast.OrBooleanExpression) {
        for (const operands of filter.operands) {
            if (!internalCheckFilter(table, operands))
                return false;
        }
        return true;
    }

    if (filter instanceof Ast.ComputeBooleanExpression)
        return checkComputeFilter(table, filter);

    if (filter instanceof Ast.AtomBooleanExpression)
        return checkAtomFilter(table, filter);

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

function checkFilter(table : Ast.Expression, filter : FilterSlot|DomainIndependentFilterSlot) : boolean {
    if (filter.schema !== null && !isSameFunction(table.schema!, filter.schema))
        return false;
    return internalCheckFilter(table, filter.ast);
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

function* iterateFields(filter : Ast.BooleanExpression) : Generator<Ast.AtomBooleanExpression|Ast.DontCareBooleanExpression, void> {
    assert(filter instanceof Ast.BooleanExpression);
    if (filter instanceof Ast.AndBooleanExpression) {
        for (const operand of filter.operands)
            yield *iterateFields(operand);
    } else if (filter instanceof Ast.NotBooleanExpression) {
        yield *iterateFields(filter.expr);
    } else if (filter instanceof Ast.AtomBooleanExpression || filter instanceof Ast.DontCareBooleanExpression) {
        yield filter;
    } else {
        assert(filter.isTrue || filter.isFalse || filter.isOr || filter.isCompute || filter.isExternal);
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
        if (!filter.isAtom && !(filter instanceof Ast.NotBooleanExpression && filter.expr.isAtom))
             return null;

        if (checkFilterUniqueness(table, filter))
            return null;

        if (hasUniqueFilter(table))
            return null;

        const existing = table.filter;
        const atom = filter instanceof Ast.NotBooleanExpression ? filter.expr : filter;
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
                if (conflict.includes(atom2.name))
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

function addFilter(table : Ast.Expression,
                   filter : FilterSlot|DomainIndependentFilterSlot,
                   options : AddFilterOptions = {}) : Ast.Expression|null {
    if (!checkFilter(table, filter))
        return null;

    return addFilterInternal(table, filter.ast, options);
}

function tableToStream(table : Ast.Expression) : Ast.Expression|null {
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
    }

    let stream;
    if (table instanceof Ast.FilterExpression && !table.schema!.is_list)
        stream = new Ast.FilterExpression(null, new Ast.MonitorExpression(null, table.expression, projArg, table.expression.schema), table.filter, table.expression.schema);
    else
        stream = new Ast.MonitorExpression(null, table, projArg, table.schema);
    return stream;
}

function builtinSayAction(loader : ThingpediaLoader,
                          pname ?: Ast.Value|string) : Ast.InvocationExpression|null {
    if (!loader.standardSchemas.say)
        return null;

    const selector = new Ast.DeviceSelector(null, 'org.thingpedia.builtin.thingengine.builtin', null, null);
    if (pname instanceof Ast.Value) {
        const param = new Ast.InputParam(null, 'message', pname);
        return new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, 'say', [param], loader.standardSchemas.say),
            loader.standardSchemas.say.removeArgument('message'));
    } else if (pname) {
        const param = new Ast.InputParam(null, 'message', new Ast.Value.VarRef(pname));
        return new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, 'say', [param], loader.standardSchemas.say),
            loader.standardSchemas.say.removeArgument('message'));
    } else {
        return new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, 'say', [], loader.standardSchemas.say),
            loader.standardSchemas.say.removeArgument('message'));
    }
}

function locationGetPredicate(loader : ThingpediaLoader,
                              loc : Ast.Value, negate = false) : DomainIndependentFilterSlot|null {
    if (!loader.standardSchemas.get_gps)
        return null;

    let filter = new Ast.BooleanExpression.Atom(null, 'location', '==', loc);
    if (negate)
        filter = new Ast.BooleanExpression.Not(null, filter);

    return { schema: null, ptype: null,
        ast: new Ast.BooleanExpression.External(null, new Ast.DeviceSelector(null, 'org.thingpedia.builtin.thingengine.builtin',null,null),'get_gps', [], filter,
            loader.standardSchemas.get_gps) };
}

function timeGetPredicate(loader : ThingpediaLoader,
                          low : Ast.Value|null, high : Ast.Value|null) : DomainIndependentFilterSlot|null {
    if (!loader.standardSchemas.get_time)
        return null;

    const operands = [];

    if (low)
        operands.push(new Ast.BooleanExpression.Atom(null, 'time', '>=', low));
    if (high)
        operands.push(new Ast.BooleanExpression.Atom(null, 'time', '<=', high));
    const filter = new Ast.BooleanExpression.And(null, operands);
    return { schema: null, ptype: null,
        ast: new Ast.BooleanExpression.External(null, new Ast.DeviceSelector(null, 'org.thingpedia.builtin.thingengine.builtin',null,null),'get_time', [], filter,
            loader.standardSchemas.get_time) };
}

function hasGetPredicate(filter : Ast.BooleanExpression) : boolean {
    if (filter instanceof Ast.AndBooleanExpression || filter instanceof Ast.OrBooleanExpression) {
        for (const op of filter.operands) {
            if (hasGetPredicate(op))
                return true;
        }
        return false;
    }
    if (filter instanceof Ast.NotBooleanExpression)
        return hasGetPredicate(filter.expr);
    return filter instanceof Ast.ExternalBooleanExpression;
}

function makeGetPredicate(proj : Ast.Expression, op : string, value : Ast.Value, negate = false) : DomainIndependentFilterSlot|null {
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
    if (!schema.out[arg].equals(value.getType()))
        return null;
    return { schema: null, ptype: null,
        ast: new Ast.BooleanExpression.External(null, selector, channel, proj.expression.invocation.in_params, filter, proj.expression.invocation.schema) };
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

function filterTableJoin(into : Ast.Expression, filteredTable : Ast.Expression|null) : Ast.Expression|null {
    // FIXME joins need to use subqueries not chains, otherwise parameters won't be available
    return null;

    /*
    if (filteredTable === null)
        return null;
    if (!(filteredTable instanceof Ast.FilterExpression))
        return null;
    let tableName;
    for (const [, invocation] of filteredTable.iteratePrimitives(false))
        tableName = invocation.channel;
    let passign;
    for (const arg of into.schema!.iterateArguments()) {
        if (arg.name !== 'id' && arg.type instanceof Type.Entity && arg.type.type.substring(arg.type.type.indexOf(':') + 1) === tableName)
            passign = arg;
    }
    if (!passign)
        return null;

    const newSchema = resolveChain(filteredTable.schema!, into.schema!);

    // TODO this should be a subquery not a chain expression

    const join = new Ast.ChainExpression(null, [filteredTable, into], newSchema);
    const filter = new Ast.BooleanExpression.Atom(null,
        passign.name, '==', new Ast.Value.VarRef('id')
    );
    return new Ast.FilterExpression(null, join, filter, newSchema);
    */
}

function arrayFilterTableJoin(into : Ast.Expression, filteredTable : Ast.Expression|null) : Ast.Expression|null {
    // FIXME joins need to use subqueries not chains, otherwise parameters won't be available
    return null;

    /*
    if (filteredTable === null)
        return null;
    if (!(filteredTable instanceof Ast.FilterExpression))
        return null;
    let tableName;
    for (const [, invocation] of filteredTable.iteratePrimitives(false))
        tableName = invocation.channel;
    let passign;
    for (const arg of into.schema!.iterateArguments()) {
        if (arg.type instanceof Type.Array && arg.type.elem instanceof Type.Entity && arg.type.elem.type.substring(arg.type.elem.type.indexOf(':') + 1) === tableName)
            passign = arg;
    }
    if (!passign)
        return null;

    const newSchema = resolveChain(filteredTable.schema!, into.schema!);

    // TODO this should be a subquery not a chain expression

    const join = new Ast.ChainExpression(null, [filteredTable, into], newSchema);
    const filter = new Ast.BooleanExpression.Atom(null,
        passign.name, 'contains', new Ast.Value.VarRef('id')
    );
    return new Ast.FilterExpression(null, join, filter, newSchema);
    */
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

    const actiontype = action.schema!.inReq[joinArg.name];
    if (!actiontype)
        return null;
    if (action.invocation.in_params.some((p) => p.name === joinArg.name))
        return null;
    const commandtype = table.schema!.out[joinArg.name];
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
        if (proj.computations.length === 0 && Object.keys(proj.expression.schema!.out).length === 1)
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
    for (const arg in table.schema!.out) {
        if (!table.schema!.out[arg].isNumber)
            continue;
        if (cleanName(table.schema!.getArgCanonical(arg)!) === `${pcleaned} ${operation}`)
            return arg;
    }
    return null;
}

function maybeGetIdFilter(filter : Ast.BooleanExpression) : Ast.Value|undefined {
    for (const atom of iterateFields(filter)) {
        if (atom.name === 'id' && atom instanceof Ast.AtomBooleanExpression)
            return atom.value;
    }
    return undefined;
}

function addReverseGetPredicateJoin(table : Ast.Expression,
                                    get_predicate_table : Ast.Expression,
                                    pname : string, negate = false) : Ast.Expression|null {
    if (!(get_predicate_table instanceof Ast.InvocationExpression) &&
        !(get_predicate_table instanceof Ast.FilterExpression &&
          get_predicate_table.expression instanceof Ast.InvocationExpression))
        return null;


    const idType = table.schema!.getArgType('id');
    if (!idType || !idType.isEntity)
        return null;
    let lhsArg = undefined;
    assert(pname);
    lhsArg = get_predicate_table.schema!.getArgument(pname);
    if (!lhsArg)
        return null;
    if (!(lhsArg.type.equals(idType) ||
        (lhsArg.type instanceof Type.Array && (lhsArg.type.elem as Type).equals(idType))))
        return null;
    if (lhsArg.name === 'id')
        return null;

    const invocation = get_predicate_table instanceof Ast.FilterExpression ? (get_predicate_table.expression as Ast.InvocationExpression).invocation : get_predicate_table.invocation;

    const newAtom = new Ast.BooleanExpression.Atom(null, pname,
        (lhsArg.type.isArray ? 'contains' : '=='),
        new Ast.Value.VarRef('id'));
    let get_predicate = new Ast.BooleanExpression.External(null,
        invocation.selector,
        invocation.channel,
        invocation.in_params,
        new Ast.BooleanExpression.And(null, [
            get_predicate_table instanceof Ast.FilterExpression ? get_predicate_table.filter : Ast.BooleanExpression.True,
            newAtom
        ]),
        invocation.schema
    );
    if (negate)
        get_predicate = new Ast.BooleanExpression.Not(null, get_predicate);
    return addFilterInternal(table, get_predicate, {});
}

function addGetPredicateJoin(table : Ast.Expression,
                             get_predicate_table : Ast.Expression,
                             pname : string|null,
                             negate = false) : Ast.Expression|null {
    if (!(get_predicate_table instanceof Ast.FilterExpression) ||
        !(get_predicate_table.expression instanceof Ast.InvocationExpression))
        return null;

    const idType = get_predicate_table.schema!.getArgType('id');
    if (!idType || !idType.isEntity)
        return null;
    let lhsArg = undefined;
    if (pname) {
        lhsArg = table.schema!.getArgument(pname);
        if (!lhsArg)
            return null;
        if (!(lhsArg.type.equals(idType) ||
            (lhsArg.type instanceof Type.Array && (lhsArg.type.elem as Type).equals(idType))))
            return null;

    } else {
        for (const arg of table.schema!.iterateArguments()) {
            if (arg.type.equals(idType) ||
                (arg.type instanceof Type.Array && (arg.type.elem as Type).equals(idType))) {
                lhsArg = arg;
                break;
            }
        }
        if (!lhsArg)
            return null;
    }
    if (lhsArg.name === 'id')
        return null;

    const idFilter = maybeGetIdFilter(get_predicate_table.filter);
    if (idFilter) {
        if (idFilter.isString)
            return null;

        let newAtom = new Ast.BooleanExpression.Atom(null, lhsArg.name,
            lhsArg.type.isArray ? 'contains': '==', idFilter);
        if (negate)
            newAtom = new Ast.BooleanExpression.Not(null, newAtom);

        return addFilterInternal(table, newAtom, {});
    }

    let newAtom = new Ast.BooleanExpression.Atom(null, 'id', (lhsArg.type.isArray ? 'in_array' : '=='), new Ast.Value.VarRef(lhsArg.name));
    if (negate)
        newAtom = new Ast.BooleanExpression.Not(null, newAtom);
    const get_predicate = new Ast.BooleanExpression.External(null,
        get_predicate_table.expression.invocation.selector,
        get_predicate_table.expression.invocation.channel,
        get_predicate_table.expression.invocation.in_params,
        new Ast.BooleanExpression.And(null, [get_predicate_table.filter, newAtom]),
        get_predicate_table.expression.invocation.schema
    );
    return addFilterInternal(table, get_predicate, {});
}

function addArrayJoin(lhs : Ast.Expression, rhs : Ast.Expression) : Ast.Expression|null {
    // FIXME joins need to use subqueries not chains, otherwise parameters won't be available
    return null;

    /*
    if (!(lhs instanceof Ast.FilterExpression))
        return null;

    const idType = rhs.schema!.getArgType('id');
    if (!idType || !idType.isEntity)
        return null;
    let lhsArg = undefined;
    for (const arg of lhs.schema!.iterateArguments()) {
        if (arg.type.equals(idType) ||
            (arg.type instanceof Type.Array && (arg.type.elem as Type).equals(idType))) {
            lhsArg = arg;
            break;
        }
    }
    if (!lhsArg)
        return null;
    if (lhsArg.name === 'id')
        return null;
    // if rhs has the same argument, lhsArg will be overridden
    if (rhs.schema!.hasArgument(lhsArg.name))
        return null;

    const newSchema = resolveChain(lhs.schema!, rhs.schema!);
    return new Ast.FilterExpression(null,
        new Ast.ChainExpression(null, [lhs, rhs], newSchema),
        new Ast.BooleanExpression.Atom(null, 'id', (lhsArg.type.isArray ? 'in_array' : '=='), new Ast.Value.VarRef(lhsArg.name)),
        newSchema);
    */
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

function makeComputeFilterExpression(table : Ast.Expression,
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
    return addFilter(table, filter);
}

function makeWithinGeoDistanceExpression(table : Ast.Expression, location : Ast.Value, filterValue : Ast.Value) : Ast.Expression|null {
    if (!table.schema!.out.geo || !table.schema!.out.geo.isLocation)
        return null;
    const filterType = filterValue.getType();
    if (!(filterType instanceof Type.Measure))
        return null;
    const unit = filterType.unit;
    assert(unit);
    if (Units.normalizeUnit(unit) !== 'm')
        return null;
    // the unit should be at least feet
    if (Units.transformToBaseUnit(1, unit) < Units.transformToBaseUnit(1, 'ft'))
        return null;
    // the distance should be at least 100 meters (if the value is small number)
    if (filterValue instanceof Ast.MeasureValue && Units.transformToBaseUnit(filterValue.value, unit) < 100)
        return null;
    return makeComputeFilterExpression(table, 'distance', [new Ast.Value.VarRef('geo'), location], new Type.Measure('m'), '<=', filterValue);
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
            if (atom.name === (operands[0] as Ast.VarRefValue).name)
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
            expr instanceof Ast.FunctionCallExpression)
            return null;

        // go inside these
        if (expr instanceof Ast.SortExpression ||
            expr instanceof Ast.MonitorExpression ||
            expr instanceof Ast.IndexExpression ||
            expr instanceof Ast.SliceExpression ||
            expr instanceof Ast.ProjectionExpression ||
            expr instanceof Ast.AliasExpression) {
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
    invocation : Ast.Invocation|undefined = undefined;

    visitInvocation(inv : Ast.Invocation) : boolean {
        this.invocation = inv;
        return false; // no need to recurse
    }
}

function getInvocation(historyItem : Ast.DialogueHistoryItem) : Ast.Invocation {
    assert(historyItem instanceof Ast.DialogueHistoryItem);

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

    // constants
    addUnit,
    makeDate,
    makeMonthDateRange,

    // builtins
    builtinSayAction,
    locationGetPredicate,
    timeGetPredicate,

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
    hasGetPredicate,
    makeGetPredicate,
    findFilterExpression,

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

    // streams
    makeEdgeFilterStream,
    tableToStream,

    // joins
    filterTableJoin,
    arrayFilterTableJoin,
    hasConflictParam,

    // compute expressions
    makeComputeExpression,
    makeComputeFilterExpression,
    makeComputeArgMinMaxExpression,
    makeAggComputeExpression,
    makeAggComputeArgMinMaxExpression,

    makeWithinGeoDistanceExpression,

    iterateFilters,
    iterateFields,

    addGetPredicateJoin,
    addReverseGetPredicateJoin,
    addArrayJoin,
};
