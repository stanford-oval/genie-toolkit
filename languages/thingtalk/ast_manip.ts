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

import { typeToStringSafe, isSameFunction, normalizeConfirmAnnotation } from './utils';
import * as Utils from './utils';

import _loader from './load-thingpedia';

function notifyAction(name : 'notify'|'return' = 'notify') : Ast.NotifyAction {
    return Ast.Action.notifyAction(name);
}

function makeDate(base : Ast.Value|Ast.DateEdge|Ast.DatePiece|Ast.WeekDayDate|null, operator : '+'|'-', offset : Ast.Value|null) : Ast.Value {
    if (!(base instanceof Ast.Value))
        base = new Ast.Value.Date(base);
    if (offset === null)
        return base;

    const value = new Ast.Value.Computation(operator, [base, offset],
        [Type.Date, new Type.Measure('ms'), Type.Date], Type.Date);
    return value;
}

function makeMonthDateRange(year : number|null, month : number|null) : [Ast.Value, Ast.Value] {
    return [
        makeDate(new Ast.DatePiece(year, month, null, null), '+', null),
        makeDate(new Ast.DatePiece(year, month, null, null), '+', new Ast.Value.Measure(1, 'mon'))
    ];
}

function getFunctionNames(ast : Ast.Node) : string[] {
    const functions : string[] = [];
    ast.visit(new class extends Ast.NodeVisitor {
        visitInvocation(invocation) {
            functions.push(invocation.selector.kind + ':' + invocation.channel);
            return true;
        }
    });
    return functions;
}

function getFunctions(ast) {
    const functions = [];
    ast.visit(new class extends Ast.NodeVisitor {
        visitInvocation(invocation) {
            functions.push(invocation.schema);
            return true;
        }
    });
    return functions;
}

function isSelfJoinStream(stream) {
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

function checkNotSelfJoinStream(stream) {
    if (isSelfJoinStream(stream))
        return null;
    return stream;
}

function betaReduce(ast, pname, value) {
    const clone = ast.clone();

    let found = false;
    for (const slot of clone.iterateSlots2({})) {
        if (slot instanceof Ast.Selector)
            continue;

        if (pname in slot.scope) {
            // if the parameter is in scope of the slot, it means we're in a filter and the same parameter name
            // is returned by the stream/table, which shadows the example/declaration parameter we're
            // trying to replace, hence we ignore this slot
            continue;
        }

        const varref = slot.get();
        if (varref.isVarRef && varref.name === pname) {
            // no parameter passing or undefined into device attributes
            if ((value.isUndefined || value.isVarRef && !value.name.startsWith('__const'))
                && slot.tag.startsWith('attribute.'))
                return null;

            slot.set(value);
            found = true;
        }
    }

    if (found) {
        // the parameter should not be in the schema for the table/stream, but sentence-generator/index.js
        // messes with the schema ands adds it there (to do quick checks of parameter passing), so here
        // we remove it again
        clone.schema = ast.schema.removeArgument(pname);
    } else {
        // in case schema was not copied by .clone() (eg if ast is a Program, which does not normally have a .schema)
        clone.schema = ast.schema;
    }

    return clone;
}

function unassignInputParameter(schema, passign, pname) {
    let arg = schema.getArgument(pname);
    if (!arg)
        return schema;
    arg = arg.clone();
    arg.name = passign;
    return schema.removeArgument(pname).addArguments([arg]);
}

// perform eta reduction
// (turn (\(x) -> f(x)) into just f
function etaReduceInvocation(invocation, pname) {
    const clone = new Ast.Invocation(null, invocation.selector, invocation.channel,
        Array.from(invocation.in_params), null);
    let passign;
    for (let i = 0; i < clone.in_params.length; i++) {
        const inParam = clone.in_params[i];
        if (inParam.value instanceof Ast.Value.VarRef && inParam.value.name === pname) {
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
        const [passign, clone] = etaReduceInvocation(table.invocation, pname);
        return [passign, new Ast.Table.Invocation(null, clone, clone.schema)];
    } else if (table.isFilter) {
        const [passign, clone] = etaReduceTable(table.table, pname);
        return [passign, new Ast.Table.Filter(null, clone, table.filter, clone.schema)];
    } else {
        // TODO
        return [undefined, table];
    }
}

function makeFilter(param, op, value, negate = false) {
    return Utils.makeFilter(_loader, param, op, value, negate);
}

function makeAndFilter(param, op, values, negate = false) {
    return Utils.makeAndFilter(_loader, param, op, values, negate);
}

function makeDateRangeFilter(param, values) {
    return Utils.makeDateRangeFilter(_loader, param, values);
}

function makeOrFilter(param, op, values, negate  =false) {
    if (values.length !== 2)
        return null;
    if (values[0].equals(values[1]))
        return null;
    const operands  = values.map((v) => makeFilter(param, op, v, negate));
    if (operands.includes(null))
        return null;
    const f = new Ast.BooleanExpression.Or(null, operands);
    if (negate)
        return new Ast.BooleanExpression.Not(null, f);
    return f;
}

function makeButFilter(param, op, values) {
    if (values.length !== 2)
        return null;
    if (values[0].equals(values[1]))
        return null;
    const operands  = [
        makeFilter(param, op, values[0]),
        makeFilter(param, op, values[1], true)
    ];
    if (operands.includes(null))
        return null;
    return new Ast.BooleanExpression.And(null, operands);
}

function makeListExpression(param, filter) {
    // TODO: handle more complicated filters
    if (!filter.isAtom)
        return null;
    if (filter.name === 'value') {
        if (_loader.params.out.has(`${param.name}+Array(Compound)`))
            return null;
    } else {
        if (!(param.name in _loader.compoundArrays))
            return null;
        const type = _loader.compoundArrays[param.name];
        if (!(filter.name in type.fields))
            return null;
    }
    const vtype = filter.value.getType();
    if (!_loader.params.out.has(`${filter.name}+${vtype}`))
        return null;
    return new Ast.Value.Filter(param, filter);
}

function makeAggregateFilter(param, aggregationOp, field, op, value) {
    if (aggregationOp === 'count') {
        if (!value.getType().isNumber)
            return null;
        assert(field === null || field === '*');
        const agg = new Ast.Value.Computation(aggregationOp, [param],
            [new Type.Array('x'), Type.Number], Type.Number);
        return new Ast.BooleanExpression.Compute(null, agg, op, value);
    } else if (['sum', 'avg', 'max', 'min'].includes(aggregationOp)) {
        const vtype = value.getType();
        if (field) {
            if (!_loader.params.out.has(`${field.name}+${vtype}`))
                return null;
        } else {
            if (!_loader.params.out.has(`${param.name}+Array(${vtype})`))
                return null;
        }
        const agg = new Ast.Value.Computation(aggregationOp, [
            param ? new Ast.Value.ArrayField(param, field.name) : param
        ], [new Type.Array(vtype), vtype], vtype);
        return new Ast.BooleanExpression.Compute(null, agg, op, value);
    }
    return null;
}

function makeAggregateFilterWithFilter(param, filter, aggregationOp, field, op, value) {
    if (filter === null)
        return null;
    const list = makeListExpression(param, filter);
    if (!list)
        return null;
    if (aggregationOp === 'count') {
        if (!value.getType().isNumber)
            return null;
        assert(field === null);
        const agg = new Ast.Value.Computation(aggregationOp, [list], [new Type.Array('x'), Type.Number], Type.Number);
        return new Ast.BooleanExpression.Compute(null, agg, op, value);
    } else if (['sum', 'avg', 'max', 'min'].includes(aggregationOp)) {
        const vtype = value.getType();
        if (field) {
            if (!_loader.params.out.has(`${field.name}+${vtype}`))
                return null;
        } else {
            if (!_loader.params.out.has(`${param.name}+Array(${vtype})`))
                return null;
        }
        const agg = new Ast.Value.Computation(aggregationOp, [
            field ? new Ast.Value.ArrayField(list, field.name) : list
        ], [new Type.Array(vtype), vtype], vtype);
        return new Ast.BooleanExpression.Compute(null, agg, op, value);
    }
    return null;
}


function makeEdgeFilterStream(proj, op, value) {
    if (!(proj instanceof Ast.Table.Projection))
        return null;

    const f = new Ast.BooleanExpression.Atom(null, proj.args[0], op, value);
    if (!checkFilter(proj.table, f))
        return null;
    if (!proj.schema.is_monitorable || proj.schema.is_list)
        return null;
    const outParams = Object.keys(proj.table.schema.out);
    if (outParams.length === 1 && _loader.flags.turking)
        return null;

    return new Ast.Stream.EdgeFilter(null, new Ast.Stream.Monitor(null, proj.table, null, proj.table.schema), f, proj.table.schema);
}

function addUnit(unit, num) {
    if (num.isVarRef) {
        const v = new Ast.Value.VarRef(num.name + '__' + unit);
        (v as any).unit = unit;
        v.getType = () => new Type.Measure(unit);
        return v;
    } else {
        return new Ast.Value.Measure(num.value, unit);
    }
}

function resolveProjection(args, schema) {
    assert(args.length >= 1);
    args = new Set(args);
    for (const arg of schema.minimal_projection)
        args.add(arg);
    for (const arg of args)
        assert(schema.hasArgument(arg));
    // if default_projection is non-empty, it's overwritten after a projection
    schema.default_projection = [];
    if (schema.annotations)
        schema.annotations.default_projection = new Ast.Value.Array([]);
    return schema.filterArguments((a) => a.is_input || args.has(a.name));
}

function makeProjection(table, pname) {
    return new Ast.Table.Projection(null, table, [pname], resolveProjection([pname], table.schema));
}
function makeStreamProjection(stream, pname) {
    return new Ast.Stream.Projection(null, stream, [pname], resolveProjection([pname], stream.schema));
}

function makeEventTableProjection(table) {
    if (table.isProjection)
        return null;

    const outParams = Object.keys(table.schema.out);
    if (outParams.length === 1 && table.schema.out[outParams[0]].isString)
        return makeProjection(table, outParams[0]);

    for (const pname in table.schema.out) {
        if (pname === 'picture_url')
            return null;
        const ptype = table.schema.out[pname];
        if (_loader.types.id.has(typeToStringSafe(ptype)))
            return null;
    }
    return new Ast.Table.Projection(null, table, ['$event'], table.schema);
}

function makeEventStreamProjection(table) {
    if (!table.schema.is_monitorable)
        return null;
    const outParams = Object.keys(table.schema.out);
    if (outParams.length === 1 && table.schema.out[outParams[0]].isString)
        return makeStreamProjection(new Ast.Stream.Monitor(null, table, null, table.schema), outParams[0]);

    for (const pname in table.schema.out) {
        if (pname === 'picture_url')
            return null;
        const ptype = table.schema.out[pname];
        if (_loader.types.id.has(typeToStringSafe(ptype)))
            return null;
    }
    return new Ast.Stream.Projection(null, new Ast.Stream.Monitor(null, table, null, table.schema), ['$event'], table.schema);
}

function makeTypeBasedTableProjection(table, ptype, ptypestr = typeToStringSafe(ptype)) {
    if (table.isProjection)
        return null;

    if (_loader.types.id.has(ptypestr)) {
        for (const pname in table.schema.out) {
            if (table.schema.out[pname].equals(ptype))
                return makeProjection(table, pname);
        }
        return null;
    } else {
        assert(!ptype.isString && !(ptype.isEntity && ptype.type === 'tt:picture'));

        const idArg = table.schema.getArgument('id');
        if (idArg && idArg.type.equals(ptype))
            return makeProjection(table, 'id');

        const outParams = Object.keys(table.schema.out);
        if (outParams.length !== 1 || !ptype.equals(table.schema.getArgType(outParams[0])))
            return null;
        return makeProjection(table, outParams[0]);
    }
}

function makeTypeBasedStreamProjection(table, ptype, ptypestr) {
    if (table.isProjection)
        return null;
    if (!table.schema.is_monitorable)
        return null;
    if (_loader.types.id.has(ptypestr)) {
        for (const pname in table.schema.out) {
            if (table.schema.out[pname].equals(ptype))
                return makeStreamProjection(new Ast.Stream.Monitor(null, table, null, table.schema), pname);
        }
        return null;
    } else {
        const idArg = table.schema.getArgument('id');
        if (idArg && idArg.type.equals(ptype))
            return makeStreamProjection(new Ast.Stream.Monitor(null, table, null, table.schema), 'id');

        const outParams = Object.keys(table.schema.out);
        if (outParams.length !== 1 || !ptype.equals(table.schema.getArgType(outParams[0])))
            return null;
        return makeStreamProjection(new Ast.Stream.Monitor(null, table, null, table.schema), outParams[0]);
    }
}

function isEqualityFilteredOnParameter(table, pname) {
    for (const [,filter] of iterateFilters(table)) {
        for (const field of iterateFields(filter)) {
            if (field.name === pname && field instanceof Ast.AtomBooleanExpression &&
                (field.operator === '==' || field.operator === '=~'))
                return true;
        }
    }

    return false;
}

function makeSingleFieldProjection(ftype, ptype, table, pname) {
    assert(table);
    assert(ftype === 'table' || ftype === 'stream');
    assert(typeof pname === 'string');

    if (!table.schema.out[pname])
        return null;

    const outParams = Object.keys(table.schema.out);
    if (outParams.length === 1)
        return table;

    if (ptype && !Type.isAssignable(table.schema.out[pname], ptype))
        return null;

    if (ftype === 'table') {
        if (pname === 'picture_url' && _loader.flags.turking)
            return null;
        if (isEqualityFilteredOnParameter(table, pname))
            return null;
        return makeProjection(table, pname);
    } else {
        if (!table.schema.is_monitorable)
            return null;
        const stream = new Ast.Stream.Monitor(null, table, null, table.schema);
        return makeStreamProjection(stream, pname);
    }
}

function makeMultiFieldProjection(ftype, table, outParams) {
    const names = [];
    for (const outParam of outParams) {
        const name = outParam.name;
        if (_loader.flags.schema_org) {
            if (name === 'id')
                return null;
        }
        if (!table.schema.out[name])
            return null;

        if (ftype === 'table') {
            if (name === 'picture_url' && _loader.flags.turking)
                return null;
        } else {
            if (!table.schema.is_monitorable)
                return null;
        }

        names.push(name);
    }

    if (ftype === 'table') {
        for (const pname of names) {
            if (isEqualityFilteredOnParameter(table, pname))
                return null;
        }

        return new Ast.Table.Projection(null, table, names, resolveProjection(names, table.schema));
    } else {
        const stream = new Ast.Stream.Monitor(null, table, null, table.schema);
        return new Ast.Stream.Projection(null, stream, names, resolveProjection(names, stream.schema));
    }
}

function makeArgMaxMinTable(table, pname, direction : 'asc'|'desc', count ?: Ast.Value) {
    const t_sort = makeSortedTable(table, pname, direction);

    if (!t_sort)
        return null;

    count = count || new Ast.Value.Number(1);
    if (count instanceof Ast.Value.Number && count.value <= 0)
        return null;

    return new Ast.Table.Slice(null, t_sort, new Ast.Value.Number(1), count, t_sort.schema);
}

function makeSortedTable(table, pname, direction = 'desc') {
    assert(typeof pname === 'string');
    assert(direction === 'asc' || direction === 'desc');

    const type = table.schema.out[pname];
    // String are comparable but we don't want to sort alphabetically here
    // (we need to use isComparable because Date/Time are comparable but not numeric)
    if (!type || !type.isComparable() || type.isString)
        return null;
    if (!table.schema.is_list || table.isIndex) //avoid conflict with primitives
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
    return new Ast.Table.Sort(null, table, pname, direction, table.schema);
}

function checkValidQuery(table) {
    // check that the query does not include "id ==" (it should be "id =~")
    // this check is only applied at the first turn (or first turn of a new domain)
    const filterTable = findFilterTable(table);
    if (!filterTable)
        return true;

    let hasIDFilter = false;
    filterTable.filter.visit(new class extends Ast.NodeVisitor {
        visitAtomBooleanExpression(expr) {
            if (expr.name === 'id' && expr.operator === '==')
                hasIDFilter = true;
            return true;
        }
    });

    return !hasIDFilter;
}

function makeProgram(rule : Ast.ExecutableStatement) : Ast.Program {
    assert(rule instanceof Ast.Statement);
    assert(!(rule instanceof Ast.Assignment));

    // FIXME: A hack for schema.org only to drop certain programs
    if (rule instanceof Ast.Command) {
        const table = rule.table;
        if (table) {
            if (!checkValidQuery(table))
                return null;
        }
    }
    if (rule instanceof Ast.Rule) {
        if (_loader.flags.nostream)
            return null;
    }
    return adjustDefaultParameters(new Ast.Program(null, [], [], [rule], null));
}

function combineStreamCommand(stream, command) {
    if (command.table) {
        stream = new Ast.Stream.Join(null, stream, command.table, [], command.table.schema);
        if (isSelfJoinStream(stream))
            return null;
        return new Ast.Statement.Rule(null, stream, command.actions);
    } else {
        return new Ast.Statement.Rule(null, stream, command.actions);
    }
}

function checkComputeFilter(table, filter) {
    if (!filter.lhs.isComputation)
        return false;

    // distance
    if (filter.lhs.op === 'distance') {
        assert.strictEqual(filter.lhs.operands.length, 2);
        if (!filter.rhs.isMeasure || Units.normalizeUnit(filter.rhs.unit) !== 'm')
            return false;
        for (const operand of filter.lhs.operands) {
            if (operand.isVarRef && !table.schema.hasArgument(operand.name))
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

    if (!table.schema.out[param.name])
        return false;

    let vtype, ftype;
    const ptype = table.schema.out[param.name];
    if (!ptype.isArray)
        return false;
    if (filter.lhs.op === 'count') {
        vtype = Type.Number;
        const canonical = table.schema.getArgCanonical(param.name);
        for (const p of table.schema.iterateArguments()) {
            if (p.name === param.name + 'Count')
                return false;
            if (p.canonical === canonical + 'count' || p.canonical === canonical.slice(0,-1) + ' count')
                return false;
        }
    } else {
        if (param.field && param.field in ptype.elem.fields)
            ftype = ptype.elem.fields[param.field].type;
        else
            ftype = ptype.elem;
        vtype = ftype;
    }
    return filter.rhs.getType().equals(vtype);
}

function checkAtomFilter(table, filter) {
    const arg = table.schema.getArgument(filter.name);
    if (!arg || arg.is_input)
        return false;

    if (arg.getAnnotation('filterable') === false)
        return false;

    const ptype = table.schema.out[filter.name];
    let vtype = ptype;
    if (filter.operator === 'contains') {
        if (ptype.isArray)
            vtype = vtype.elem;
        else if (ptype.isRecurrentTimeSpecification)
            vtype = [Type.Date, Type.Time];
        else
            return false;
    } else if (filter.operator === 'contains~') {
        if (!vtype.isArray || (!vtype.elem.isEntity && !vtype.elem.isString))
            return false;
        vtype = Type.String;
    } else if (filter.operator === 'in_array') {
        vtype = new Type.Array(ptype);
    } else if (filter.operator === 'in_array~') {
        if (!vtype.isEntity && !vtype.isString)
            return false;
        vtype = new Type.Array(Type.String);
    } else if (filter.operator === '=~') {
        if (!ptype.isEntity && !ptype.isString)
            return false;
        if (ptype.isEntity && filter.name !== 'id')
            return false;
        vtype = Type.String;
    }

    if (!Array.isArray(vtype))
        vtype = [vtype];

    let typeMatch = false;
    for (const type of vtype) {
        if (filter.value.getType().equals(type))
            typeMatch = true;
    }
    if (!typeMatch)
        return false;


    if (vtype.isNumber || vtype.isMeasure) {
        let min = -Infinity;
        const minArg = arg.getImplementationAnnotation('min_number');
        if (minArg !== undefined)
            min = minArg;
        const maxArg = arg.getImplementationAnnotation('max_number');
        let max = Infinity;
        if (maxArg !== undefined)
            max = maxArg;

        if (filter.value.isNumber) {
            const value = filter.value.toJS();
            if (value < min || value > max)
                return false;
        }
    }
    return true;
}

function checkFilter(table, filter) {
    while (table.isProjection)
        table = table.table;

    if (filter.isNot)
        filter = filter.expr;
    if (filter.isExternal)
        return true;
    if (filter.isAnd || filter.isOr) {
        for (const operands of filter.operands) {
            if (!checkFilter(table, operands))
                return false;
        }
        return true;
    }

    if (filter.isCompute)
        return checkComputeFilter(table, filter);

    if (filter.isAtom)
        return checkAtomFilter(table, filter);

    if (filter.isDontCare) {
        const arg = table.schema.getArgument(filter.name);
        if (!arg || arg.is_input)
            return false;
        if (arg.getAnnotation('filterable') === false)
            return false;
        return true;
    }

    throw new Error(`Unexpected filter type ${filter}`);
}

function* iterateFilters(table) {
    if (table.isInvocation || table.isVarRef || table.isResultRef)
        return;

    if (table.isFilter) {
        yield [table.schema, table.filter];
    } else if (table.isJoin) {
        yield *iterateFilters(table.lhs);
        yield *iterateFilters(table.rhs);
    } else {
        yield *iterateFilters(table.table);
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

function hasUniqueFilter(table) {
    for (const [, filter] of iterateFilters(table)) {
        if (checkFilterUniqueness(table, filter))
            return true;
    }
    return false;
}

function checkFilterUniqueness(table, filter) {
    if (filter.isAnd)
        return filter.operands.some((f) => checkFilterUniqueness(table, f));
    // note: a filter of the form
    // (id == "foo" || id == "bar")
    // is treated as "unique" because it defines the set of elements
    // and we should not filter further
    if (filter.isOr)
        return filter.operands.every((f) => checkFilterUniqueness(table, f));

    if (filter.isExternal)
        return false;

    if (filter.isNot)
        return true;

    if (filter.isTrue || filter.isFalse)
        return false;

    if (filter.isCompute)
        return false;

    if (filter.operator !== '==' && filter.operator !== 'in_array')
        return false;

    const arg = table.schema.getArgument(filter.name);
    if (!arg)
        return false;
    return arg.unique;
}

function normalizeFilter(table, filter) {
    if (filter.lhs && filter.lhs.isComputation && filter.lhs.op === 'count' && filter.lhs.operands.length === 1) {
        const name = filter.lhs.operands[0].name;
        const canonical = table.schema.getArgCanonical(name);
        if (!canonical)
            return null;
        for (const p of table.schema.iterateArguments()) {
            if (p.name === name + 'Count' ||
                p.canonical === canonical + ' count' ||
                p.canonical === canonical.slice(0,-1) + ' count')
                return new Ast.BooleanExpression.Atom(null, p.name, filter.operator, filter.rhs);
        }
    }

    return filter;
}

interface AddFilterOptions {
    ifFilter ?: boolean;
}

function addFilter(table : Ast.Table,
                   filter : Ast.BooleanExpression,
                   options : AddFilterOptions = {}) {
    filter = normalizeFilter(table, filter);
    if (!filter)
        return null;

    if (!checkFilter(table, filter))
        return null;

    // when an "unique" parameter has been used in the table
    if (table.schema.no_filter)
        return null;

    // if the query is single result, only add "if" filters, not "with" filters
    // ("if" filters are only used with streams)
    if (!table.schema.is_list && !options.ifFilter)
        return null;

    if (table instanceof Ast.Table.Projection) {
        const added = addFilter(table.table, filter);
        if (added === null)
            return null;
        return new Ast.Table.Projection(null, added, table.args, table.schema);
    }

    if (table instanceof Ast.Table.Filter) {
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

        const arg = table.schema.getArgument(atom.name);
        const conflict = arg.getImplementationAnnotation<string[]>('conflict_filter');
        if (conflict !== undefined) {
            for (const atom2 of iterateFields(existing)) {
                if (conflict.includes(atom2.name))
                    return null;
            }
        }

        const newFilter = new Ast.BooleanExpression.And(null, [existing, filter]).optimize();
        return new Ast.Table.Filter(null, table.table, newFilter, table.schema);
    }

    // FIXME deal with the other table types (maybe)

    const schema = table.schema.clone();
    if (checkFilterUniqueness(table, filter)) {
        schema.is_list = false;
        schema.no_filter = true;
    }
    return new Ast.Table.Filter(null, table, filter, schema);
}

function addFilterToProgram(program : Ast.Program, filter : Ast.BooleanExpression) {
    const rule = program.rules[0];
    if (rule instanceof Ast.Command && !rule.table)
        return null;

    if (rule instanceof Ast.Rule && !rule.stream.isMonitor)
        return null;

    const clone = program.clone();

    const clonerule = clone.rules[0];
    assert(!(clonerule instanceof Ast.Assignment));

    if (clonerule instanceof Ast.Rule) {
        const stream = clonerule.stream;
        assert(stream instanceof Ast.Stream.Monitor);
        if (!checkFilter(stream.table, filter))
            return null;

        stream.table = addFilter(stream.table, filter);
        if (!stream.table)
            return null;
    } else {
        clonerule.table = addFilter(clonerule.table, filter);
        if (!clonerule.table)
            return null;
    }

    return clone;
}

function tableToStream(table, projArg) {
    if (!table.schema.is_monitorable)
        return null;
    let stream;
    if (table.isFilter && !table.schema.is_list)
        stream = new Ast.Stream.EdgeFilter(null, new Ast.Stream.Monitor(null, table.table, projArg, table.table.schema), table.filter, table.table.schema);
    else
        stream = new Ast.Stream.Monitor(null, table, projArg, table.schema);
    return stream;
}

function builtinSayAction(pname ?: Ast.Value|string) : Ast.Action|null {
    if (!_loader.standardSchemas.say)
        return null;

    const selector = new Ast.Selector.Device(null, 'org.thingpedia.builtin.thingengine.builtin', null, null);
    if (pname instanceof Ast.Value) {
        const param = new Ast.InputParam(null, 'message', pname);
        return new Ast.Action.Invocation(null, new Ast.Invocation(null, selector, 'say', [param], _loader.standardSchemas.say),
            _loader.standardSchemas.say.removeArgument('message'));
    } else if (pname) {
        const param = new Ast.InputParam(null, 'message', new Ast.Value.VarRef(pname));
        return new Ast.Action.Invocation(null, new Ast.Invocation(null, selector, 'say', [param], _loader.standardSchemas.say),
            _loader.standardSchemas.say.removeArgument('message'));
    } else {
        return new Ast.Action.Invocation(null, new Ast.Invocation(null, selector, 'say', [], _loader.standardSchemas.say),
            _loader.standardSchemas.say.removeArgument('message'));
    }
}

function locationGetPredicate(loc, negate = false) {
    if (!_loader.standardSchemas.get_gps)
        return null;

    let filter = new Ast.BooleanExpression.Atom(null, 'location', '==', loc);
    if (negate)
        filter = new Ast.BooleanExpression.Not(null, filter);

    return new Ast.BooleanExpression.External(null, new Ast.Selector.Device(null, 'org.thingpedia.builtin.thingengine.builtin',null,null),'get_gps', [], filter,
        _loader.standardSchemas.get_gps);
}

function timeGetPredicate(low, high) {
    if (!_loader.standardSchemas.get_time)
        return null;

    const operands = [];

    if (low)
        operands.push(new Ast.BooleanExpression.Atom(null, 'time', '>=', low));
    if (high)
        operands.push(new Ast.BooleanExpression.Atom(null, 'time', '<=', high));
    const filter = new Ast.BooleanExpression.And(null, operands);
    return new Ast.BooleanExpression.External(null, new Ast.Selector.Device(null, 'org.thingpedia.builtin.thingengine.builtin',null,null),'get_time', [], filter,
        _loader.standardSchemas.get_time);
}

function hasGetPredicate(filter) {
    if (filter.isAnd || filter.isOr) {
        for (const op of filter.operands) {
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
    if (!proj.isProjection)
        return null;
    if (!proj.table.isInvocation)
        return null;
    const arg = proj.args[0];
    let filter = new Ast.BooleanExpression.Atom(null, arg, op, value);
    if (negate)
        filter = new Ast.BooleanExpression.Not(null, filter);
    const selector = proj.table.invocation.selector;
    const channel = proj.table.invocation.channel;
    const schema = proj.table.invocation.schema;
    if (!schema.out[arg].equals(value.getType()))
        return null;
    return new Ast.BooleanExpression.External(null, selector, channel, proj.table.invocation.in_params, filter, proj.table.invocation.schema);
}

// perform a join with parameter passing
function mergeSchemas(functionType, lhsSchema, rhsSchema, passign) {
    // handle parameter name conflicts by having the second primitive win
    const newArgNames = new Set;
    const newArgs = [];
    for (const arg of rhsSchema.iterateArguments()) {
        if (arg.name === passign)
            continue;
        newArgNames.add(arg.name);
        newArgs.push(arg);
    }
    for (const arg of lhsSchema.iterateArguments()) {
        if (newArgNames.has(arg.name))
            continue;
        /*if (!lhsSchema.isArgInput(arg.name))
            continue;*/
        newArgNames.add(arg.name);
        newArgs.push(arg);
    }

    return new Ast.ExpressionSignature(null, functionType, null /* class */, [] /* extends */, newArgs, {
        is_list: lhsSchema.is_list || rhsSchema.is_list,
        is_monitorable: lhsSchema.is_monitorable && rhsSchema.is_monitorable,
        require_filter: lhsSchema.require_filter || rhsSchema.require_filter,
        default_projection: [...new Set<string>(lhsSchema.default_projection.concat(rhsSchema.default_projection))],
        minimal_projection: [...new Set<string>(lhsSchema.minimal_projection.concat(rhsSchema.minimal_projection))],
        no_filter: lhsSchema.no_filter && rhsSchema.no_filter
    });
}

function filterTableJoin(into, filteredTable) {
    if (filteredTable === null)
        return null;
    if (!filteredTable.isFilter)
        return null;
    let tableName;
    for (const [, invocation] of filteredTable.iteratePrimitives())
        tableName = invocation.channel;
    let passign;
    for (const arg of into.schema.iterateArguments()) {
        if (arg.name !== 'id' && arg.type.isEntity && arg.type.type.substring(arg.type.type.indexOf(':') + 1) === tableName)
            passign = arg;
    }
    if (!passign)
        return null;

    const newSchema = mergeSchemas('query', filteredTable.schema, into.schema, '');

    const join = new Ast.Table.Join(null, filteredTable, into, [], newSchema);
    const filter = new Ast.BooleanExpression.Atom(null,
        passign.name, '==', new Ast.Value.VarRef('id')
    );
    return new Ast.Table.Filter(null, join, filter, newSchema);
}

function arrayFilterTableJoin(into, filteredTable) {
    if (filteredTable === null)
        return null;
    if (!filteredTable.isFilter)
        return null;
    let tableName;
    for (const [, invocation] of filteredTable.iteratePrimitives())
        tableName = invocation.channel;
    let passign;
    for (const arg of into.schema.iterateArguments()) {
        if (arg.type.isArray && arg.type.elem.isEntity && arg.type.elem.type.substring(arg.type.type.indexOf(':') + 1) === tableName)
            passign = arg;
    }
    if (!passign)
        return null;

    const newSchema = mergeSchemas('query', filteredTable.schema, into.schema, '');

    const join = new Ast.Table.Join(null, filteredTable, into, [], newSchema);
    const filter = new Ast.BooleanExpression.Atom(null,
        passign.name, 'contains', new Ast.Value.VarRef('id')
    );
    return new Ast.Table.Filter(null, join, filter, newSchema);
}

function tableJoinReplacePlaceholder(into, pname, projection) {
    if (projection === null)
        return null;
    const intotype = into.schema.inReq[pname];
    if (!intotype)
        return null;
    if (!projection.isProjection) {
        if (intotype.isString || (intotype.isEntity && intotype.type === 'tt:picture'))
            return null;

        projection = makeTypeBasedTableProjection(projection, intotype);
        if (projection === null)
            return null;
    }
    if (projection.args.length !== 1)
        throw new TypeError('???');
    const joinArg = projection.args[0];
    if (joinArg === '$event' && ['p_body', 'p_message', 'p_caption', 'p_status'].indexOf(pname) < 0)
        return null;
    const ptype = joinArg === '$event' ? Type.String : projection.schema.out[joinArg];
    if (!ptype.equals(intotype))
        return null;

    const [passign, etaReduced] = etaReduceTable(into, pname);
    if (passign === undefined) {
        //console.error(`Ignored join between ${into} and ${projection}: cannot find parameter ${pname}`);
        return null;
    }
    //console.log('passign: ' + passign + ', ptype: ' + ptype);

    const newSchema = mergeSchemas('query', projection.schema, etaReduced.schema, passign);
    const replacement = joinArg === '$event' ? new Ast.Value.Event(null) : new Ast.Value.VarRef(joinArg);
    return new Ast.Table.Join(null, projection.table, etaReduced, [new Ast.InputParam(null, passign, replacement)], newSchema);
}

function actionReplaceParamWith(into, pname, projection) {
    const joinArg = projection.args[0];
    if (joinArg === '$event' && ['p_body', 'p_message', 'p_caption', 'p_status'].indexOf(pname) < 0)
        return null;
    if (_loader.flags.dialogues) {
        if (joinArg !== 'id')
            return null;
        if (projection.table.isInvocation)
            return null;
    }
    const ptype = joinArg === '$event' ? Type.String : projection.schema.out[joinArg];
    const intotype = into.schema.inReq[pname];
    if (!intotype || !ptype.equals(intotype))
        return null;

    const replacement = joinArg === '$event' ? new Ast.Value.Event(null) : new Ast.Value.VarRef(joinArg);
    return betaReduce(into, pname, replacement);
}

function actionReplaceParamWithTable(into, pname, projection) {
    if (projection === null)
        return null;
    const intotype = into.schema.inReq[pname];
    if (!intotype)
        return null;
    if (!projection.isProjection) {
        if (intotype.isString || (intotype.isEntity && intotype.type === 'tt:picture'))
            return null;

        projection = makeTypeBasedTableProjection(projection, intotype);
        if (projection === null)
            return null;
    }
    if (projection.args.length !== 1)
        throw new TypeError('???');
    const reduced = actionReplaceParamWith(into, pname, projection);
    if (reduced === null)
        return null;
    return new Ast.Statement.Command(null, projection.table, [reduced]);
}

function actionReplaceParamWithStream(into, pname, projection) {
    if (projection === null)
        return null;
    if (!projection.isProjection || !projection.stream || projection.args.length !== 1)
        return null;
    const reduced = actionReplaceParamWith(into, pname, projection);
    if (reduced === null)
        return null;
    return new Ast.Statement.Rule(null, projection.stream, [reduced]);
}

function getDoCommand(command, pname, joinArg) {
    //if (command.actions.length !== 1 || command.actions[0].selector.isBuiltin)
    //    throw new TypeError('???');
    const actiontype = command.actions[0].schema.inReq[pname];
    if (!actiontype)
        return null;
    if (_loader.flags.dialogues && joinArg.name !== 'id')
        return null;
    const commandtype = joinArg.isEvent ? Type.String : command.table.schema.out[joinArg.name];
    if (!commandtype || !commandtype.equals(actiontype))
        return null;

    const reduced = betaReduce(command.actions[0], pname, joinArg);
    if (reduced === null)
        return null;
    return new Ast.Statement.Command(null, command.table, [reduced]);
}

function whenDoRule(rule, pname, joinArg) {
    //if (rule.actions.length !== 1 || rule.actions[0].selector.isBuiltin)
    //    throw new TypeError('???');
    const actiontype = rule.actions[0].schema.inReq[pname];
    if (!actiontype)
        return null;
    if (_loader.flags.dialogues && joinArg.name !== 'id')
        return null;
    const commandtype = joinArg.isEvent ? Type.String : rule.stream.schema.out[joinArg.name];
    if (!commandtype || !commandtype.equals(actiontype))
        return null;
    if (joinArg.isEvent && (rule.stream.isTimer || rule.stream.isAtTimer))
        return null;

    const reduced = betaReduce(rule.actions[0], pname, joinArg);
    if (reduced === null)
        return null;
    return new Ast.Statement.Rule(null, rule.stream, [reduced]);
}

function whenGetStream(stream, pname, joinArg) {
    if (!stream.isJoin)
        throw new TypeError('???');
    const commandtype = stream.table.schema.inReq[pname];
    if (!commandtype)
        return null;
    const streamtype = joinArg.isEvent ? Type.String : stream.stream.schema.out[joinArg.name];
    if (!streamtype || !streamtype.equals(commandtype))
        return null;
    if (joinArg.isEvent && (stream.stream.isTimer || stream.stream.isAtTimer))
        return null;

    const [passign, etaReduced] = etaReduceTable(stream.table, pname);
    if (passign === undefined) {
        //console.error(`Ignored join between ${into} and ${projection}: cannot find parameter ${pname}`);
        return null;
    }
    //console.log('passign: ' + passign + ', ptype: ' + ptype);

    const newSchema = mergeSchemas('stream', stream.schema, etaReduced.schema, passign);
    return new Ast.Stream.Join(null, stream.stream, etaReduced, stream.in_params.concat([new Ast.InputParam(null, passign, joinArg)]), newSchema);
}

function isConstantAssignable(value, ptype) {
    if (!ptype)
        return false;
    const vtype = value.getType();
    if (!Type.isAssignable(vtype, ptype))
        return false;
    // prevent mixing date and type (ThingTalk allows it to support certain time get predicates)
    if ((vtype.isDate && ptype.isTime) || (vtype.isTime && ptype.isDate))
        return false;
    if (value.getType().isEnum && (!ptype.isEnum || ptype.entries.indexOf(value.value) < 0))
        return false;
    return true;
}

function replacePlaceholderWithConstant(lhs, pname, value) {
    const ptype = lhs.schema.inReq[pname];
    if (!isConstantAssignable(value, ptype))
        return null;
    if (ptype.isEnum && ptype.entries.indexOf(value.toJS()) < 0)
        return null;
    //if (pname === 'p_low')
    //    console.log('p_low := ' + ptype + ' / ' + value.getType());
    if (value.isDate && value.value === null && value.offset === null)
        return null;
    return betaReduce(lhs, pname, value);
}

function replacePlaceholderWithUndefined(lhs, pname, typestr) {
    if (!lhs.schema.inReq[pname])
        return null;
    if (typestr !== typeToStringSafe(lhs.schema.inReq[pname]))
        return null;
    return betaReduce(lhs, pname, new Ast.Value.Undefined(true));
}

function sayProjection(proj) {
    if (proj === null)
        return null;

    // this function is also used for aggregation
    if (proj.isProjection) {
        assert(proj.args.length > 0);
        if (proj.args.length === 1 && proj.args[0] === 'picture_url')
            return null;
        // if the function only contains one parameter, do not generate projection for it
        if (Object.keys(proj.table.schema.out).length === 1)
            return null;
        if (!_loader.flags.projection)
            return null;

        // remove all projection args that are part of the minimal projection
        const newArgs = proj.args.filter((a) => !proj.table.schema.minimal_projection.includes(a));
        const newSchema = resolveProjection(proj.args, proj.table.schema);
        if (newArgs.length === 0) {
            proj = proj.table;
        } else {
            newArgs.sort();
            proj.args = newArgs;
            proj.schema = newSchema;
        }
    }
    return new Ast.Statement.Command(null, proj, [notifyAction()]);
}

function sayProjectionProgram(proj) {
    const stmt = sayProjection(proj);
    if (stmt === null)
        return null;
    return makeProgram(stmt);
}

function isQueryProgram(program) {
    if (!program.isProgram)
        return false;

    const hasTrigger = program.rules.length > 0 && program.rules.some((r) => r.isRule);
    if (hasTrigger)
        return false;

    for (const [primType, prim] of program.iteratePrimitives(false)) {
        if (prim.selector.isBuiltin)
            continue;
        if (primType === 'action')
            return false;
    }

    return true;
}

function isContinuousProgram(program) {
    if (!program.isProgram)
        return false;

    for (const rule of program.rules) {
        if (rule.isRule)
            return true;
    }
    return false;
}

function isCompleteCommand(thingtalk) {
    for (const [, slot] of thingtalk.iterateSlots()) {
        if (slot instanceof Ast.Selector)
            continue;
        if (slot.value.isUndefined)
            return false;
    }
    return true;
}

function addTimerToProgram(program, timer) {
    const newrules = program.rules.map((r) => {
        if (r.isAssignment)
            return r;
        if (r.table)
            return new Ast.Statement.Rule(null, new Ast.Stream.Join(null, timer, r.table, [], r.table.schema), r.actions);
        else
            return new Ast.Statement.Rule(null, timer, r.actions);
    });
    return new Ast.Program(null, program.classes, program.declarations, newrules, program.principal, program.oninputs);
}

function makeMonitor(program) {
    const newrules = program.rules.map((r) => {
        return new Ast.Statement.Rule(null, new Ast.Stream.Monitor(null, r.table, null, r.table.schema), r.actions);
    });
    return new Ast.Program(null, program.classes, program.declarations, newrules, program.principal, program.oninputs);
}

function replaceAnyParameterFromContext(context, newValue) {
    const type = newValue.getType();
    assert(!type.isAny);

    const slotsOfType = [];

    const clone = context.clone();
    for (const [schema, slot] of clone.iterateSlots()) {
        if (slot instanceof Ast.Selector)
            continue;
        if (slot.value.isVarRef)
            continue;
        const argname = slot.name;
        let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
        if (slot instanceof Ast.BooleanExpression.Atom && slot.operator === 'contains')
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
    for (const [schema, slot] of program.iterateSlots()) {
        if (slot instanceof Ast.Selector)
            continue;
        if (slot.value.isVarRef || !slot.value.isUndefined)
            continue;

        const argname = slot.name;
        let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
        if (slot instanceof Ast.BooleanExpression.Atom && slot.operator === 'contains')
            type = type.elem;
        if (!isConstantAssignable(newValue, type))
            return null;

        return new Ast.Input.Bookkeeping(null,
            new Ast.BookkeepingIntent.Answer(null, newValue)
        );
    }

    return null;
}

function hasConflictParam(table, pname, operation) {
    function cleanName(name) {
        if (name.endsWith(' value'))
            name = name.substring(0, name.length - ' value'.length);
        if (name.includes('.')) {
            const components = name.split('.');
            name = components[components.length - 1];
        }
        return name;

    }
    const pcleaned = cleanName(pname);
    for (const arg in table.schema.out) {
        if (!table.schema.out[arg].isNumber)
            continue;
        if (cleanName(table.schema.getArgCanonical(arg)) === `${pcleaned} ${operation}`)
            return arg;
    }
    return false;
}

function maybeGetIdFilter(filter : Ast.BooleanExpression) : Ast.Value|undefined {
    for (const atom of iterateFields(filter)) {
        if (atom.name === 'id' && atom instanceof Ast.AtomBooleanExpression)
            return atom.value;
    }
    return undefined;
}

function addReverseGetPredicateJoin(table, get_predicate_table, pname, negate = false) {
    if (!get_predicate_table.isInvocation &&
        !(get_predicate_table.isFilter && get_predicate_table.table.isInvocation))
        return null;


    const idType = table.schema.getArgType('id');
    if (!idType || !idType.isEntity)
        return null;
    let lhsArg = undefined;
    assert(pname);
    lhsArg = get_predicate_table.schema.getArgument(pname);
    if (!lhsArg)
        return null;
    if (!(lhsArg.type.equals(idType) ||
        (lhsArg.type.isArray && lhsArg.type.elem.equals(idType))))
        return null;
    if (lhsArg.name === 'id')
        return null;

    const invocation = get_predicate_table.isFilter ? get_predicate_table.table.invocation : get_predicate_table.invocation;

    const newAtom = new Ast.BooleanExpression.Atom(null, pname,
        (lhsArg.type.isArray ? 'contains' : '=='),
        new Ast.Value.VarRef('id'));
    let get_predicate = new Ast.BooleanExpression.External(null,
        invocation.selector,
        invocation.channel,
        invocation.in_params,
        new Ast.BooleanExpression.And(null, [
            get_predicate_table.isFilter ? get_predicate_table.filter : Ast.BooleanExpression.True,
            newAtom
        ]),
        invocation.schema
    );
    if (negate)
        get_predicate = new Ast.BooleanExpression.Not(null, get_predicate);
    return addFilter(table, get_predicate);
}

function addGetPredicateJoin(table, get_predicate_table, pname, negate = false) {
    if (!get_predicate_table.isFilter || !get_predicate_table.table.isInvocation)
        return null;


    const idType = get_predicate_table.schema.getArgType('id');
    if (!idType || !idType.isEntity)
        return null;
    let lhsArg = undefined;
    if (pname) {
        lhsArg = table.schema.getArgument(pname);
        if (!lhsArg)
            return null;
        if (!(lhsArg.type.equals(idType) ||
            (lhsArg.type.isArray && lhsArg.type.elem.equals(idType))))
            return null;

    } else {
        for (const arg of table.schema.iterateArguments()) {
            if (arg.type.equals(idType) ||
                (arg.type.isArray && arg.type.elem.equals(idType))) {
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
        let newAtom = new Ast.BooleanExpression.Atom(null, lhsArg.name,
            lhsArg.type.isArray ? 'contains': '==', idFilter);
        if (negate)
            newAtom = new Ast.BooleanExpression.Not(null, newAtom);

        return addFilter(table, newAtom);
    }

    let newAtom = new Ast.BooleanExpression.Atom(null, 'id', (lhsArg.type.isArray ? 'in_array' : '=='), new Ast.Value.VarRef(lhsArg.name));
    if (negate)
        newAtom = new Ast.BooleanExpression.Not(null, newAtom);
    const get_predicate = new Ast.BooleanExpression.External(null,
        get_predicate_table.table.invocation.selector,
        get_predicate_table.table.invocation.channel,
        get_predicate_table.table.invocation.in_params,
        new Ast.BooleanExpression.And(null, [get_predicate_table.filter, newAtom]),
        get_predicate_table.table.invocation.schema
    );
    return addFilter(table, get_predicate);
}

function addArrayJoin(lhs, rhs) {
    if (!lhs.isFilter)
        return null;

    const idType = rhs.schema.getArgType('id');
    if (!idType || !idType.isEntity)
        return null;
    let lhsArg = undefined;
    for (const arg of lhs.schema.iterateArguments()) {
        if (arg.type.equals(idType) ||
            (arg.type.isArray && arg.type.elem.equals(idType))) {
            lhsArg = arg;
            break;
        }
    }
    if (!lhsArg)
        return null;
    if (lhsArg.name === 'id')
        return null;
    // if rhs has the same argument, lhsArg will be overridden
    if (rhs.schema.hasArgument(lhsArg.name))
        return null;

    const newSchema = mergeSchemas('query', lhs.schema, rhs.schema, null);
    return new Ast.Table.Filter(null,
        new Ast.Table.Join(null, lhs, rhs, [], newSchema),
        new Ast.BooleanExpression.Atom(null, 'id', (lhsArg.type.isArray ? 'in_array' : '=='), new Ast.Value.VarRef(lhsArg.name)),
        newSchema);
}

function makeComputeExpression(table, operation, operands, resultType) {
    const computeSchema = table.schema.addArguments([
        new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, operation, resultType)]);
    const expression = new Ast.Value.Computation(operation, operands);
    if (operation === 'distance') {
        expression.overload = [Type.Location, Type.Location, new Type.Measure('m')];
        expression.type = new Type.Measure('m');
    }

    return new Ast.Table.Compute(null, table, expression, null, computeSchema);
}

function makeComputeProjExpression(table, operation, operands, resultType) {
    const compute = makeComputeExpression(table, operation, operands, resultType);
    return makeProjection(compute, operation);
}

function makeComputeFilterExpression(table, operation, operands, resultType, filterOp, filterValue) {
    // do not compute on a computed table
    if (table.schema.out[operation])
        return null;

    const expression = new Ast.Value.Computation(operation, operands);
    if (operation === 'distance') {
        expression.overload = [Type.Location, Type.Location, new Type.Measure('m')];
        expression.type = new Type.Measure('m');
    }
    const filter = new Ast.BooleanExpression.Compute(null, expression, filterOp, filterValue);
    if (filter)
        return addFilter(table, filter);
    return null;
}

function makeWithinGeoDistanceExpression(table, location, filterValue) {
    if (!table.schema.out.geo || !table.schema.out.geo.isLocation)
        return null;
    if (!filterValue.getType().isMeasure)
        return null;
    const unit = filterValue.unit;
    assert(unit);
    if (Units.normalizeUnit(unit) !== 'm')
        return null;
    // the unit should be at least feet
    if (Units.transformToBaseUnit(1, unit) < Units.transformToBaseUnit(1, 'ft'))
        return null;
    // the distance should be at least 100 meters (if the value is small number)
    if (filterValue.isMeasure && Units.transformToBaseUnit(filterValue.value, unit) < 100)
        return null;
    return makeComputeFilterExpression(table, 'distance', [new Ast.Value.VarRef('geo'), location], new Type.Measure('m'), '<=', filterValue);
}

function makeComputeArgMinMaxExpression(table, operation, operands, resultType, direction : 'asc'|'desc' = 'desc') {
    if (hasUniqueFilter(table))
        return null;
    for (const [, filter] of iterateFilters(table)) {
        for (const atom of iterateFields(filter)) {
            if (atom.name === operands[0].name)
                return null;
        }
    }
    const compute = makeComputeExpression(table, operation, operands, resultType);
    const sort = new Ast.Table.Sort(null, compute, operation, direction, compute.schema);
    return new Ast.Table.Index(null, sort, [new Ast.Value.Number(1)], compute.schema);
}

function makeAggComputeExpression(table, operation, field, list, resultType) {
    if (hasUniqueFilter(table))
        return null;
    let name;
    assert(list.isVarRef || list.isFilter);
    if (list.isVarRef)
        name = list.name;
    else
        name = list.value.name;
    assert(typeof name === 'string');
    const canonical = table.schema.getArgCanonical(name);
    for (const p of table.schema.iterateArguments()) {
        if (p.name === name + 'Count' || p.canonical === canonical + 'count' || p.canonical === canonical.slice(0,-1) + ' count')
            return makeProjection(table, p.name);
    }
    const computeSchema = table.schema.addArguments([
        new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, operation, resultType)]);
    const expression = new Ast.Value.Computation(operation, [field ? new Ast.Value.ArrayField(list, field) : list]);
    if (operation === 'count') {
        expression.overload = [new Type.Array('x'), Type.Number];
        expression.type = Type.Number;
    } else {
        expression.overload = [new Type.Array(resultType), resultType];
        expression.type = resultType;
    }

    return new Ast.Table.Compute(null, table, expression, null, computeSchema);
}

function makeAggComputeProjExpression(table, operation, field, list, resultType) {
    const compute = makeAggComputeExpression(table, operation, field, list, resultType);
    if (!compute)
        return null;
    return makeProjection(compute, operation);
}

function makeAggComputeArgMinMaxExpression(table, operation, field, list, resultType, direction : 'asc'|'desc' = 'desc') {
    if (hasUniqueFilter(table))
        return null;
    const compute = makeAggComputeExpression(table, operation, field, list, resultType);
    if (!compute)
        return null;
    const sort = new Ast.Table.Sort(null, compute, operation, direction, compute.schema);
    return new Ast.Table.Index(null, sort, [new Ast.Value.Number(1)], compute.schema);

}

function hasArgumentOfType(invocation, type) {
    for (const arg of invocation.schema.iterateArguments()) {
        if (!arg.is_input)
            continue;
        if (arg.type.equals(type))
            return true;
    }
    return false;
}

function filterUsesParam(filter, pname) {
    let used = false;
    filter.visit(new class extends Ast.NodeVisitor {
        visitExternalBooleanExpression() {
            // do not recurse
            return false;
        }
        visitValue() {
            // do not recurse
            return false;
        }

        visitAtomBooleanExpression(atom) {
            used = used || pname === atom.name;
            return true;
        }
    });
    return used;
}

interface AddInputParamsOptions {
    allowOutput ?: boolean;
}

function checkInvocationInputParam(invocation, param, options : AddInputParamsOptions = {}) {
    assert(invocation instanceof Ast.Invocation);
    const arg = invocation.schema.getArgument(param.name);
    if (!arg || (!arg.is_input && !options.allowOutput) || !isConstantAssignable(param.value, arg.type))
        return false;

    if (arg.type.isNumber || arg.type.isMeasure) {
        // __const varref, likely
        if (!param.value.isNumber && !param.value.isMeasure)
            return false;

        let min = -Infinity;
        const minArg = arg.getImplementationAnnotation<number>('min_number');
        if (minArg !== undefined)
            min = minArg;
        const maxArg = arg.getImplementationAnnotation<number>('max_number');
        let max = Infinity;
        if (maxArg !== undefined)
            max = maxArg;

        const value = param.value.toJS();
        if (value < min || value > max)
            return false;
    }

    return true;
}

function addInvocationInputParam(invocation, param, options ?: AddInputParamsOptions) {
    if (!checkInvocationInputParam(invocation, param, options))
        return null;

    const clone = invocation.clone();
    for (const existing of clone.in_params) {
        if (existing.name === param.name) {
            if (existing.value.isUndefined) {
                existing.value = param.value;
                return clone;
            } else {
                return null;
            }
        }
    }
    clone.in_params.push(param);
    return clone;
}

function addActionInputParam(action, param) {
    if (!(action instanceof Ast.Action.Invocation || action instanceof Ast.Table.Invocation))
        return null;
    const newInvocation = addInvocationInputParam(action.invocation, param);
    if (newInvocation === null)
        return null;

    if (action instanceof Ast.Action.Invocation)
        return new Ast.Action.Invocation(null, newInvocation, action.schema.removeArgument(param.name));
    else
        return new Ast.Table.Invocation(null, newInvocation, action.schema.removeArgument(param.name));
}

function replaceSlotBagPlaceholder(bag, pname, value) {
    if (!value.isConstant())
        return null;
    let ptype = bag.schema.getArgType(pname);
    if (!ptype)
        return null;
    if (ptype.isArray)
        ptype = ptype.elem;
    const vtype = value.getType();
    if (!ptype.equals(vtype))
        return null;
    if (bag.has(pname))
        return null;
    const clone = bag.clone();
    clone.set(pname, value);
    return clone;
}

function replaceErrorMessagePlaceholder(msg, pname, value) {
    const newbag = replaceSlotBagPlaceholder(msg.bag, pname, value);
    if (newbag === null)
        return null;
    return { code: msg.code, bag: newbag };
}

/**
 * Find the filter table in the context.
 *
 * Returns filterTable
 */
function findFilterTable(root) {
    let table = root;
    while (!table.isFilter) {
        if (table.isSequence ||
            table.isHistory ||
            table.isWindow ||
            table.isTimeSeries)
            throw new Error('NOT IMPLEMENTED');

        // do not touch these with filters
        if (table.isAggregation ||
            table.isVarRef ||
            table.isResultRef)
            return null;

        // go inside these
        if (table.isSort ||
            table.isIndex ||
            table.isSlice ||
            table.isProjection ||
            table.isCompute ||
            table.isAlias) {
            table = table.table;
            continue;
        }

        if (table.isJoin) {
            // go right on join, always
            table = table.rhs;
            continue;
        }

        assert(table.isInvocation);
        // if we get here, there is no filter table at all
        return null;
    }

    return table;
}

function getInvocation(historyItem) {
    assert(historyItem instanceof Ast.DialogueHistoryItem);

    let invocation = undefined;
    historyItem.visit(new class extends Ast.NodeVisitor {
        visitInvocation(inv) {
            invocation = inv;
            return false; // no need to recurse
        }
    });
    return invocation;
}

function adjustDefaultParameters(stmt) {
    stmt.visit(new class extends Ast.NodeVisitor {
        visitInvocation(invocation) {
            invocation.in_params = invocation.in_params.filter((ip) => {
                const arg = invocation.schema.getArgument(ip.name);
                assert(arg && arg.is_input);
                const _default = arg.impl_annotations.default;
                if (_default && ip.value.equals(_default))
                    return false;
                return true;
            });
            return false;
        }
    });
    return stmt;
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
    normalizeConfirmAnnotation,
    adjustDefaultParameters,

    // constants
    addUnit,
    makeDate,
    makeMonthDateRange,

    // builtins
    notifyAction,
    builtinSayAction,
    locationGetPredicate,
    timeGetPredicate,

    makeProgram,
    combineStreamCommand,

    checkNotSelfJoinStream,

    // low-level helpers
    betaReduce,
    etaReduceTable,

    // placeholder replacement
    replacePlaceholderWithConstant,
    replacePlaceholderWithUndefined,
    tableJoinReplacePlaceholder,
    actionReplaceParamWithTable,
    actionReplaceParamWithStream,
    getDoCommand,
    whenDoRule,
    whenGetStream,
    checkInvocationInputParam,
    addInvocationInputParam,
    addActionInputParam,
    replaceSlotBagPlaceholder,
    replaceErrorMessagePlaceholder,

    // filters
    hasUniqueFilter,
    makeFilter,
    makeAndFilter,
    makeOrFilter,
    makeButFilter,
    makeDateRangeFilter,
    makeAggregateFilter,
    makeAggregateFilterWithFilter,
    checkFilter,
    addFilter,
    hasGetPredicate,
    makeGetPredicate,
    findFilterTable,

    makeListExpression,
    makeSortedTable,
    makeArgMaxMinTable,
    checkValidQuery,

    // projections
    resolveProjection,
    makeProjection,
    makeEventTableProjection,
    makeEventStreamProjection,
    makeTypeBasedTableProjection,
    makeTypeBasedStreamProjection,
    makeSingleFieldProjection,
    makeMultiFieldProjection,
    sayProjection,
    sayProjectionProgram,

    // streams
    makeEdgeFilterStream,
    tableToStream,

    isQueryProgram,
    isContinuousProgram,
    isCompleteCommand,
    replaceAnyParameterFromContext,
    fillNextSlot,
    addTimerToProgram,
    addFilterToProgram,
    makeMonitor,

    // joins
    filterTableJoin,
    arrayFilterTableJoin,
    hasConflictParam,

    // compute expressions
    makeComputeExpression,
    makeComputeProjExpression,
    makeComputeFilterExpression,
    makeComputeArgMinMaxExpression,
    makeAggComputeExpression,
    makeAggComputeProjExpression,
    makeAggComputeArgMinMaxExpression,

    makeWithinGeoDistanceExpression,

    iterateFilters,
    iterateFields,

    addGetPredicateJoin,
    addReverseGetPredicateJoin,
    addArrayJoin,
};
