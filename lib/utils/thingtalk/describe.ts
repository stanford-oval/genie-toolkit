// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017-2020 The Board of Trustees of the Leland Stanford Junior University
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
import interpolate from 'string-interp';
import type Gettext from 'node-gettext';
import { Ast, Type, Builtin } from 'thingtalk';

import { clean, cleanKind } from '../misc-utils';

const OLD_ANNOTATION_RENAME : { [key : string] : string } = {
    'property': 'npp',
    'reverse_property': 'npi',
    'verb': 'avp',
    'passive_verb': 'pvp',
    'adjective': 'apv',
    'implicit_identity': 'npv',
};
const NEW_ANNOTATION_RENAME : { [key : string] : string } = {
    'npp': 'property',
    'npi': 'reverse_property',
    'avp': 'verb',
    'pvp': 'passive_verb',
    'apv': 'adjective',
    'npv': 'implicit_identity',
};

type ScopeMap = Record<string, string>;

export class Describer {
    private _ : (x : string) => string;
    locale : string;
    timezone : string|undefined;

    private _format : InstanceType<typeof interpolate.Formatter>; // FIXME
    private _interp : (x : string, args : Record<string, unknown>) => string;

    constructor(gettext : Gettext, locale : string = gettext.locale, timezone ?: string) {
        this._ = gettext.dgettext.bind(gettext, 'genie-toolkit');
        this.locale = locale;
        this.timezone = timezone;

        this._format = new interpolate.Formatter(locale, timezone);
        this._interp = (string, args) => interpolate(string, args, { locale, timezone })||'';
    }

    private _displayLocation(loc : Ast.Location) {
        if (loc instanceof Ast.AbsoluteLocation) {
            if (loc.display)
                return loc.display;
            else
                return this._interp(this._("[Latitude: ${loc.lat:.3} deg, Longitude: ${loc.lon:.3} deg]"), { loc });
        } else if (loc instanceof Ast.UnresolvedLocation) {
            return loc.name;
        } else {
            assert(loc instanceof Ast.RelativeLocation);
            switch (loc.relativeTag) {
            case 'current_location':
                return this._("here");
            case 'home':
                return this._("at home");
            case 'work':
                return this._("at work");
            default:
                return loc.relativeTag;
            }
        }
    }

    private _describeTime(time : Ast.Time) {
        if (time instanceof Ast.AbsoluteTime) {
            const date = new Date;
            date.setHours(time.hour);
            date.setMinutes(time.minute);
            date.setSeconds(time.second);
            if (time.second !== 0) {
                return this._format.timeToString(date, {
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit'
                });
            } else {
                return this._format.timeToString(date, {
                    hour: 'numeric',
                    minute: '2-digit'
                });
            }
        } else {
            assert(time instanceof Ast.RelativeTime);
            switch (time.relativeTag) {
                case 'morning':
                    return this._('the morning');
                case 'evening':
                    return this._('the evening');
                default:
                    return time.relativeTag;
            }
        }
    }

    private _describeDate(date : Date|Ast.DatePiece|Ast.DateEdge|Ast.WeekDayDate|null) {
        let base;

        if (date === null) {
            base = this._("now");
        } else if (date instanceof Ast.DatePiece) {
            const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december" ];
            const year = this._(date.year === null ?
                              "this year" :
                              date.year.toString());
            const month = this._(date.month === null ?
                               (date.day === null ? "january" : "this month") :
                               monthNames[date.month - 1]);
            const day = this._(date.day === null ?
                             "1" :
                             date.day.toString());
            const time = date.time === null ? this._("start of day") : this._describeTime(date.time);
            base = this._interp(this._("${time} on day ${day} of ${month}, ${year}"),
                                { year, month, day, time });
        } else if (date instanceof Ast.DateEdge) {
            let unit;
            switch (date.unit) {
            case 'ms':
                unit = this._("this millisecond");
                break;
            case 's':
                unit = this._("this second");
                break;
            case 'm':
                unit = this._("this minute");
                break;
            case 'h':
                unit = this._("this hour");
                break;
            case 'day':
                unit = this._("today");
                break;
            case 'week':
                unit = this._("this week");
                break;
            case 'mon':
                unit = this._("this month");
                break;
            case 'year':
                unit = this._("this year");
                break;
            }
            if (date.edge === 'start_of')
                base = this._interp(this._("the start of ${unit}"), { unit });
            else
                base = this._interp(this._("the end of ${unit}"), { unit });
        } else if (date instanceof Ast.WeekDayDate) {
            const time = date.time === null ? this._("start of day") : this._describeTime(date.time);
            const weekday = this._(date.weekday);
            base = this._interp(this._("${time} on ${weekday}"), { time, weekday });
        } else {
            if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0)
                base = this._format.dateToString(date);
            else
                base = this._format.dateAndTimeToString(date);
        }

        return base;
    }

    // public API that always returns a string
    describeArg(arg : Ast.Value, scope ?: ScopeMap) : string {
        return this._interp('${v}', {
            v: this._describeArg(arg, scope)
        });
    }

    // internal API that returns an array or number in some cases (so string-interp can do
    // better formatting than we can)
    private _describeArg(arg : Ast.Value, scope : ScopeMap = {}) : unknown {
        if (arg instanceof Ast.ArrayValue)
            return arg.value.map((v) => this._describeArg(v, scope));
        // for Number, we return the actual value, so the sentence can do plural selection
        if (arg instanceof Ast.NumberValue)
            return arg.value;

        if (arg instanceof Ast.VarRefValue) {
            let name;
            if (arg.name in scope)
                name = scope[arg.name];
            else
                name = clean(arg.name);
            return this._interp(this._("the ${name}"), { name });
        }
        if (arg instanceof Ast.ComputationValue) {
            if ((arg.op === '+' || arg.op === '-') &&
                arg.operands[0].isDate) {
                const base = this._describeArg(arg.operands[0], scope);
                const offset = this._describeArg(arg.operands[1], scope);

                if (arg.op === '+')
                    return this._interp(this._("${offset} past ${base}"), { offset, base });
                else
                    return this._interp(this._("${offset} before ${base}"), { offset, base });
            }

            if (arg.op === '+' && arg.operands.every((op) => op.isMeasure))
                return arg.operands.map((v) => this._describeArg(v, scope)).join(' ');

            const operands : unknown[] = arg.operands.map((v) => this._describeArg(v, scope));
            switch (arg.op) {
            case '+':
                return this._interp(this._("${lhs} plus ${rhs}"), { lhs: operands[0], rhs: operands[1] });
            case '-':
                return this._interp(this._("${lhs} minus ${rhs}"), { lhs: operands[0], rhs: operands[1] });
            case '*':
                return this._interp(this._("${lhs} times ${rhs}"), { lhs: operands[0], rhs: operands[1] });
            case '/':
                return this._interp(this._("${lhs} divided by ${rhs}"), { lhs: operands[0], rhs: operands[1] });
            case '%':
                return this._interp(this._("${lhs} modulo ${rhs}"), { lhs: operands[0], rhs: operands[1] });
            case '**':
                return this._interp(this._("${lhs} to the power of ${rhs}"), { lhs: operands[0], rhs: operands[1] });
            case 'distance':
                return this._interp(this._("the distance between ${lhs} and ${rhs}"), { lhs: operands[0], rhs: operands[1] });
            case 'max':
                return this._interp(this._("the maximum ${arg}"), { arg: operands[0] });
            case 'min':
                return this._interp(this._("the minimum ${arg}"), { arg: operands[0] });
            case 'avg':
                return this._interp(this._("the average ${arg}"), { arg: operands[0] });
            case 'sum':
                return this._interp(this._("the total ${arg}"), { arg: operands[0] });
            case 'count':
                return this._interp(this._("the number of ${arg}"), { arg: operands[0] });
            default:
                throw new TypeError(`Unexpected computation operator ${arg.op}`);
            }
        }

        if (arg instanceof Ast.FilterValue) {
            return this._interp(this._("${value} for which ${filter}"), {
                value: this._describeArg(arg.value, scope),
                filter: this.describeFilter(arg.filter, this._compoundTypeToSchema((arg.type as InstanceType<typeof Type.Array>).elem as Type), scope)
            });
        }
        if (arg instanceof Ast.ArrayFieldValue) {
            return this._interp(this._("the ${field} of ${value}"), {
                field: arg.arg!.canonical,
                value: this._describeArg(arg.value, scope)
            });
        }

        if (arg instanceof Ast.ContextRefValue) {
            switch (arg.name) {
            case 'selection':
                return this._("the selection on the screen");
            default:
                throw new Error(`unsupported context value`);
            }
        }
        if (arg instanceof Ast.UndefinedValue)
            return '____';
        if (arg instanceof Ast.EventValue) {
            switch (arg.name) {
            case 'program_id':
                return this._("the program ID");
            case 'type':
                return this._("the device type");
            case 'source':
                return this._("the requester");
            default:
                return this._("the result");
            }
        }
        if (arg instanceof Ast.LocationValue)
            return this._displayLocation(arg.value);
        if (arg instanceof Ast.StringValue)
            return `“${arg.value}”`;
        if (arg instanceof Ast.EntityValue) {
            if (arg.type === 'tt:username' || arg.type === 'tt:contact_name' || arg.type === 'tt:contact_group_name')
                return '@' + arg.value;
            if (arg.type === 'tt:hashtag')
                return '#' + arg.value;
            if (arg.display)
                return arg.display;
            return arg.value;
        }
        if (arg instanceof Ast.CurrencyValue)
            return new Builtin.Currency(arg.value, arg.code).toLocaleString(this.locale);
        if (arg instanceof Ast.EnumValue)
            return clean(arg.value);
        if (arg instanceof Ast.MeasureValue) {
            if (arg.unit.startsWith('default')) {
                switch (arg.unit) {
                case 'defaultTemperature':
                    return this._interp(this._("${value:.1} degrees"), { value: arg.value });
                default:
                    throw new TypeError('Unexpected default unit ' + arg.unit);
                }
            } else {
                return arg.value + ' ' + arg.unit;
            }
        }
        if (arg instanceof Ast.BooleanValue)
            return arg.value ? this._("true") : this._("false");
        if (arg instanceof Ast.DateValue)
            return this._describeDate(arg.value);
        if (arg instanceof Ast.TimeValue)
            return this._describeTime(arg.value);

        return String(arg);
    }

    private _describeOperator(argcanonical : unknown,
                              op : string,
                              value : unknown,
                              negate : boolean,
                              ptype : Type) {
        let op_key = op;
        switch (op) {
        case '=~':
            op_key = 'substr';
            break;
        case '~=':
            op_key = 'rev_substr';
            break;
        case '==':
            op_key = 'eq';
            break;
        case 'in_array~':
        case '~in_array':
            op_key = 'in_array';
            break;
        case 'contains~':
        case '~contains':
            op_key = 'contains';
            break;
        case '>=':
            if (ptype.isTime || ptype.isDate)
                op_key = 'after';
            else
                op_key = 'geq';
            break;
        case '<=':
            if (ptype.isTime || ptype.isDate)
                op_key = 'before';
            else
                op_key = 'leq';
            break;
        }
        if (negate)
            op_key = 'not_' + op_key;

        return this._interp(this._("${op_key:select: \
            not_contains {${argcanonical} do not contain ${value}} \
            contains {${argcanonical} contain ${value}} \
            not_substr {${argcanonical} does not contain ${value}} \
            substr {${argcanonical} contains ${value}} \
            not_in_array {${argcanonical} is none of ${value}} \
            in_array {${argcanonical} is any of ${value:disjunction}} \
            not_rev_substr {${argcanonical} is not contained in ${value}} \
            rev_substr {${argcanonical} is contained in ${value}} \
            not_starts_with {${argcanonical} does not start with ${value}} \
            starts_with {${argcanonical} starts with ${value}} \
            not_ends_with {${argcanonical} does not end with ${value}} \
            ends_with {${argcanonical} ends with ${value}} \
            not_prefix_of {${argcanonical} is not a prefix of ${value}} \
            prefix_of {${argcanonical} is a prefix of ${value}} \
            not_suffix_of {${argcanonical} is not a suffix of ${value}} \
            suffix_of {${argcanonical} is a suffix of ${value}} \
            not_eq {${argcanonical} is not equal to ${value}} \
            eq {${argcanonical} is equal to ${value}} \
            not_geq {${argcanonical} is less than ${value}} \
            geq {${argcanonical} is greater than or equal to ${value}} \
            not_leq {${argcanonical} is greater than ${value}} \
            leq {${argcanonical} is less than or equal to ${value}} \
            not_before {${argcanonical} is after ${value}} \
            before {${argcanonical} is before ${value}} \
            not_after {${argcanonical} is before ${value}} \
            after {${argcanonical} is after ${value}} \
        }"), { op_key, argcanonical, value }); //"
    }

    private _compoundTypeToSchema(type : Type) {
        const args = [];
        if (type instanceof Type.Compound) {
            for (const field in type.fields) {
                args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, field, type.fields[field].type, {
                    nl: type.fields[field].nl_annotations,
                    impl: type.fields[field].impl_annotations
                }));
            }
        } else {
            args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, 'value', type, {}));
        }
        const localschema = new Ast.ExpressionSignature(null, 'query', null, [], args, {});
        return localschema;
    }

    private _describeAtomFilter(expr : Ast.AtomBooleanExpression|Ast.ComputeBooleanExpression,
                                schema : Ast.ExpressionSignature|null,
                                scope : ScopeMap,
                                negate : boolean,
                                canonical_overwrite : ScopeMap = {}) {
        let lhs : unknown, rhs : unknown, ptype : Type;
        if (expr instanceof Ast.AtomBooleanExpression) {
            const argname = expr.name;
            if (argname in canonical_overwrite) {
                lhs = canonical_overwrite[argname];
            } else if (schema) {
                if (argname in schema.index)
                    lhs = schema.getArgCanonical(argname)!;
                else
                    lhs = scope[argname];
            } else {
                lhs = scope[argname];
            }
            lhs = this._interp(this._("the ${name}"), { name: lhs });
            rhs = this._describeArg(expr.value, scope);
            if (schema)
                ptype = schema.out[argname] || schema.inReq[argname] || schema.inOpt[argname];
            else
                ptype = Type.Any;
        } else {
            lhs = this._describeArg(expr.lhs, scope);
            rhs = this._describeArg(expr.rhs, scope);
            ptype = expr.lhs.getType();
        }
        return this._describeOperator(lhs, expr.operator, rhs, negate, ptype);
    }

    describeFilter(expr : Ast.BooleanExpression,
                   schema : Ast.ExpressionSignature|null = null,
                   scope : ScopeMap = {},
                   canonical_overwrite : ScopeMap = {}) : string {
        const recursiveHelper = (expr : Ast.BooleanExpression) : string => {
            if (expr.isTrue || (expr instanceof Ast.AndBooleanExpression && expr.operands.length === 0))
                return this._("true");
            if (expr.isFalse || (expr instanceof Ast.OrBooleanExpression && expr.operands.length === 0))
                return this._("false");
            if (expr instanceof Ast.DontCareBooleanExpression) {
                const argname = expr.name;
                let argcanonical;
                if (argname in canonical_overwrite) {
                    argcanonical = canonical_overwrite[argname];
                } else if (schema) {
                    if (argname in schema.index)
                        argcanonical = schema.getArgCanonical(argname);
                    else
                        argcanonical = scope[argname];
                } else {
                    argcanonical = scope[argname];
                }
                return this._interp(this._("any value of ${argcanonical} is acceptable"), { argcanonical });
            }

            // FIXME these should use this._format.listToString but that might not behave well
            // on all versions of node / ICU
            if (expr instanceof Ast.AndBooleanExpression || expr instanceof Ast.OrBooleanExpression) {
                return expr.operands.map(recursiveHelper).reduce((lhs, rhs) => {
                    return this._interp(this._("${lhs} ${op} ${rhs}"), {
                        lhs, rhs,
                        op: expr.isAnd ? 'and' : 'or'
                    });
                });
            }
            if (expr instanceof Ast.NotBooleanExpression && expr.expr instanceof Ast.AtomBooleanExpression)
                return this._describeAtomFilter(expr.expr, schema, scope, true, canonical_overwrite);
            if (expr instanceof Ast.NotBooleanExpression)
                return this._interp(this._("not ${expr}"), { expr: recursiveHelper(expr.expr) });
            if (expr instanceof Ast.ExternalBooleanExpression) {
                if (expr.selector.kind === 'org.thingpedia.builtin.thingengine.builtin' &&
                    expr.channel === 'get_time') {
                    const schema = expr.schema!.clone();
                    return this.describeFilter(expr.filter, schema, scope, { time: this._("current time") });
                }
                if (expr.selector.kind === 'org.thingpedia.builtin.thingengine.builtin' &&
                    expr.channel === 'get_gps') {
                    const schema = expr.schema!.clone();
                    return this.describeFilter(expr.filter, schema, scope, { location: this._("my location") });
                }

                const primdesc = this.describePrimitive(expr, scope, []);

                if (expr.filter instanceof Ast.AtomBooleanExpression) {
                    // common case
                    const lhs = this._interp(this._("the ${param} of ${expr}"), {
                        param: expr.filter.name,
                        expr: primdesc
                    });

                    return this._describeOperator(lhs,
                                                  expr.filter.operator,
                                                  this._describeArg(expr.filter.value, scope),
                                                  false,
                                                  expr.schema!.out[expr.filter.name]);
                } else if (expr.filter instanceof Ast.NotBooleanExpression &&
                           expr.filter.expr instanceof Ast.AtomBooleanExpression) {
                    // common case 2
                    const lhs = this._interp(this._("the ${param} of ${expr}"), {
                        param: expr.filter.expr.name,
                        expr: primdesc
                    });

                    return this._describeOperator(lhs,
                                                  expr.filter.expr.operator,
                                                  this._describeArg(expr.filter.expr.value, scope),
                                                  true,
                                                  expr.schema!.out[expr.filter.expr.name]);
                } else {
                    // general case
                    return this._interp(this._("for ${expr}, ${filter}"), {
                        expr: primdesc,
                        filter: this.describeFilter(expr.filter, expr.schema, scope)
                    });
                }
            }
            assert(expr instanceof Ast.AtomBooleanExpression ||
                   expr instanceof Ast.ComputeBooleanExpression);
            return this._describeAtomFilter(expr, schema, scope, false, canonical_overwrite);
        };

        return recursiveHelper(expr);
    }

    private _getDeviceAttribute(selector : Ast.DeviceSelector, name : string) : unknown|undefined {
        for (const attr of selector.attributes) {
            if (attr.name === name)
                return this._describeArg(attr.value, {});
        }
        return undefined;
    }

    describePrimitive(obj : Ast.Invocation|Ast.ExternalBooleanExpression,
                      scope ?: ScopeMap,
                      extraInParams : Ast.InputParam[] = []) : string {
        const kind = obj.selector.kind;
        const channel = obj.channel;
        const schema = obj.schema;
        assert(schema instanceof Ast.FunctionDef);

        const argMap = new Map;

        let confirm;
        if (kind === 'remote' || kind.startsWith('__dyn')) {
            // special case internal sending/receiving
            if (channel === 'send')
                confirm = this._("send it to $__principal");
            else if (channel === 'receive')
                confirm = this._("you receive something from $__principal");
            else
                throw TypeError('Invalid @remote channel ' + channel);
        } else {
            confirm = schema.confirmation!;

            const cleanKind = schema.class ? schema.class.canonical : clean(obj.selector.kind);

            let selector;
            const name = this._getDeviceAttribute(obj.selector, 'name');
            if (obj.selector.device)
                selector = this._interp(this._("your ${device}"), { device: obj.selector.device.name });
            else if (obj.selector.all && name)
                selector = this._interp(this._("all your ${name} ${device}"), { name, device: cleanKind });
            else if (obj.selector.all)
                selector = this._interp(this._("all your ${device}"), { device: cleanKind });
            else if (name)
                selector = this._interp(this._("your ${name} ${device}"), { name, device: cleanKind });
            else
                selector = this._interp(this._("your ${device}"), { device: cleanKind });

            argMap.set('__device', selector);
        }
        for (const inParam of obj.in_params.concat(extraInParams)) {
            const argname = inParam.name;

            // explicitly set the argument to ____ if it is optional but $undefined
            // but leave it unspecified (js undefined) if it is required and $undefined
            //
            // this allows to use confirmation:
            // "get xkcd ${?number ${number}}"
            // to map
            // @com.xkcd.get_comic(number=$undefined)
            // to "get xkcd number ____"
            // and
            // @com.xkcd.get_comic()
            // to "get xkcd"

            if (inParam.value.isUndefined && schema.isArgRequired(argname))
                continue;
            argMap.set(argname, this._describeArg(inParam.value, scope));
        }

        const usedArgs = new Set;
        confirm = interpolate(confirm, (param) => {
            usedArgs.add(param);
            return argMap.get(param);
        }, {
            locale: this.locale,
            timezone: this.timezone,
            failIfMissing: false,
            nullReplacement: '____'
        })||'';

        let firstExtra = true;
        for (const inParam of obj.in_params.concat(extraInParams)) {
            const argname = inParam.name;
            if (usedArgs.has(argname))
                continue;
            const argcanonical = schema.getArgCanonical(argname);
            const value = this._describeArg(inParam.value, scope);

            if (argname.startsWith('__'))
                continue;
            if (kind === 'remote' || kind.startsWith('__dyn'))
                continue;
            if (inParam.value.isUndefined && schema.isArgRequired(argname))
                continue;
            if (firstExtra) {
                confirm = this._interp(this._("${confirm} with ${argcanonical} equal to ${value}"), { confirm, argcanonical, value });
                firstExtra = false;
            } else {
                confirm = this._interp(this._("${confirm} and ${argcanonical} equal to ${value}"), { confirm, argcanonical, value });
            }
        }

        return confirm;
    }

    private _describeIndex(index : Ast.Value, tabledesc : string) {
        if (index instanceof Ast.NumberValue) {
            if (index.value < 0) {
                return this._interp(this._("${index:ordinal: \
                    =1 {the last ${table}}\
                    =2 {the second to last ${table}}\
                    one {the ${index}st last ${table}}\
                    two {the ${index}nd last ${table}}\
                    few {the ${index}rd last ${table}}\
                    other {the ${index}th last ${table}}\
                }"), { index: -index.value, table: tabledesc });
            } else {
                return this._interp(this._("${index:ordinal: \
                    =1 {the first ${table}}\
                    =2 {the second ${table}}\
                    =3 {the third ${table}}\
                    one {the ${index}st ${table}}\
                    two {the ${index}nd ${table}}\
                    few {the ${index}rd ${table}}\
                    other {the ${index}th ${table}}\
                }"), { index: index.value, table: tabledesc});
            }
        } else {
            return this._interp(this._("the ${table} with index ${index}"), {
                index: this._describeArg(index),
                table: tabledesc
            });
        }
    }

    private _describeFilteredTable(table : Ast.FilteredTable,
                                   extraInParams : Ast.InputParam[]) : string {
        const inner = this.describeTable(table.table, extraInParams);
        if (!table.schema!.is_list) {
            return this._interp(this._("${table} such that ${filter}"), {
                table: inner,
                filter: this.describeFilter(table.filter, table.schema)
            });
        }

        const filter = table.filter.optimize();
        const slotClauses = [];
        const otherClauses = [];

        for (const clause of (filter instanceof Ast.AndBooleanExpression ? filter.operands : [filter])) {
            if (!(clause instanceof Ast.AtomBooleanExpression)) {
                otherClauses.push(clause);
                continue;
            }

            const name = clause.name;
            const arg = table.schema!.getArgument(name);
            if (!arg) {
                otherClauses.push(clause);
                continue;
            }

            const isEqualityFilter = ['==', '=~', 'contains', 'contains~', '~contains', 'in_array', 'in_array~', '~in_array'].includes(clause.operator);
            if (!isEqualityFilter) {
                otherClauses.push(clause);
                continue;
            }

            let canonical;
            if (!arg.metadata.canonical)
                canonical = { base: [clean(name)] };
            else if (typeof arg.metadata.canonical === 'string')
                canonical = { base: [arg.metadata.canonical] };
            else
                canonical = arg.metadata.canonical;

            if (!canonical.default)
                canonical.default = 'base';
            if (canonical.default in NEW_ANNOTATION_RENAME)
                canonical.default = NEW_ANNOTATION_RENAME[canonical.default];
            if (canonical.default === 'implicit_identity') {
                otherClauses.push(clause);
                continue;
            }

            let form;
            if (canonical[canonical.default])
                form = canonical[canonical.default];
            else if (canonical[OLD_ANNOTATION_RENAME[canonical.default]])
                form = canonical[OLD_ANNOTATION_RENAME[canonical.default]];
            if (Array.isArray(form))
                form = form[0];
            if (!form || typeof form !== 'string') {
                otherClauses.push(clause);
                continue;
            }

            slotClauses.push([clause, canonical, form]);
        }

        // sort "adjective" and "passive verb" slots first, "preposition" slots at the end
        slotClauses.sort((a, b) => {
            const [, canonicalA] = a;
            const [, canonicalB] = b;

            const isAdjectiveOrPassiveVerbA = ['adjective', 'passive_verb'].includes(canonicalA.default);
            const isPrepositionA = canonicalA.default === 'preposition';
            const isAdjectiveOrPassiveVerbB = ['adjective', 'passive_verb'].includes(canonicalB.default);
            const isPrepositionB = canonicalB.default === 'preposition';

            if (isAdjectiveOrPassiveVerbA && !isAdjectiveOrPassiveVerbB)
                return -1;
            if (isAdjectiveOrPassiveVerbB && !isAdjectiveOrPassiveVerbA)
                return 1;
            if (isPrepositionA && !isPrepositionB)
                return 1;
            if (isPrepositionB && !isPrepositionA)
                return -1;
            return 0;
        });

        let tabledesc = inner;
        let first = true;

        for (const [clause, canonical, form] of slotClauses) {
            let value = this._describeArg(clause.value, {});
            if (Array.isArray(value)) {
                value = this._format.listToString(value, {
                    type: ['in_array', '~in_array', 'in_array~'].includes(clause.operator) ? 'disjunction' : 'conjunction'
                });
            }

            let clauseString;
            if (form.indexOf('#') >= 0)
                clauseString = form.replace('#', value);
            else
                clauseString = form + ' ' + value;

            if (first) {
                tabledesc = this._interp(this._("${canonical_key:select: \
                    base {${table} that have ${filter}} \
                    property {${table} that have ${filter}} \
                    reverse_property {${table} that are ${filter}}\
                    verb {${table} that ${filter}} \
                    adjective {${filter} ${table}} \
                    passive_verb {${table} ${filter}} \
                    preposition {${table} ${filter}} \
                }"), { canonical_key: canonical.default, table: tabledesc, filter: clauseString });

                if (!['adjective', 'passive_verb'].includes(canonical.default))
                    first = false;
            } else {
                tabledesc = this._interp(this._("${canonical_key:select: \
                    base {${table} and have ${filter}} \
                    property {${table} and have ${filter}} \
                    reverse_property {${table} and are ${filter}}\
                    verb {${table} and ${filter}} \
                    adjective {${filter} ${table}} \
                    passive_verb {${table} ${filter}} \
                    preposition {${table} ${filter}} \
                }"), { canonical_key: canonical.default, table: tabledesc, filter: clauseString });
            }
        }

        if (otherClauses.length > 0) {
            return this._interp(this._("${table} such that ${filter}"), {
                table: tabledesc,
                filter: this.describeFilter(new Ast.BooleanExpression.And(null, otherClauses).optimize(), table.schema)
            });
        } else {
            return tabledesc;
        }
    }

    describeTable(table : Ast.Table, extraInParams : Ast.InputParam[] = []) : string {
        if (table instanceof Ast.VarRefTable) {
            return clean(table.name);
        } else if (table instanceof Ast.InvocationTable) {
            return this.describePrimitive(table.invocation, {}, extraInParams);
        } else if (table instanceof Ast.FilteredTable) {
            return this._describeFilteredTable(table, extraInParams);
        } else if (table instanceof Ast.ProjectionTable) {
            return this._interp(this._("the ${param} of ${table}"), {
                table: this.describeTable(table.table, extraInParams),
                param: this.__describeArgList(table.args, table.schema!)
            });
        } else if (table instanceof Ast.ComputeTable) {
            return this._interp(this._("${table} and ${expression}"), {
                table: this.describeTable(table.table, extraInParams),
                expression: this._describeArg(table.expression)
            });
        } else if (table instanceof Ast.AliasTable) {
            return this.describeTable(table.table, extraInParams);
        } else if (table instanceof Ast.AggregationTable) {
            if (table.field === '*') {
                return this._interp(this._("the number of ${table}"), {
                    table: this.describeTable(table.table, extraInParams)
                });
            }

            let desc;
            switch (table.operator) {
            case 'avg':
                desc = this._("the average ${param} in ${table}");
                break;
            case 'min':
                desc = this._("the minimum ${param} in ${table}");
                break;
            case 'max':
                desc = this._("the maximum ${param} in ${table}");
                break;
            case 'sum':
                desc = this._("the sum of the ${param} in ${table}");
                break;
            case 'count':
                desc = this._("the number of ${param}s in ${table}");
                break;
            default:
                throw new TypeError(`Invalid aggregation ${table.operator}`);
            }
            return this._interp(desc, {
                param: table.schema!.getArgCanonical(table.field),
                table: this.describeTable(table.table, extraInParams)
            });

        // recognize argmin/argmax
        } else if (table instanceof Ast.IndexTable && table.indices.length === 1 && table.indices[0] instanceof Ast.NumberValue &&
            table.table instanceof Ast.SortedTable &&
            (table.indices[0].toJS() === 1 || table.indices[0].toJS() === -1)) {
            const index = table.indices[0] as Ast.NumberValue;

            if ((index.value === 1 && table.table.direction === 'asc') ||
                (index.value === -1 && table.table.direction === 'desc')) {
                return this._interp(this._("the ${table} with the minimum ${param}"), {
                    table: this.describeTable(table.table.table, extraInParams),
                    param: table.schema!.getArgCanonical(table.table.field)
                });
            } else {
                return this._interp(this._("the ${table} with the maximum ${param}"), {
                    table: this.describeTable(table.table.table, extraInParams),
                    param: table.schema!.getArgCanonical(table.table.field)
                });
            }

        // recognize argmin/argmax top K
        } else if (table instanceof Ast.SlicedTable && table.table instanceof Ast.SortedTable && table.base instanceof Ast.NumberValue &&
            (table.base.value === 1 || table.base.value === -1)) {
                if ((table.base.value === 1 && table.table.direction === 'asc') ||
                    (table.base.value === -1 && table.table.direction === 'desc')) {
                return this._interp(this._("the ${limit} ${table} with the minimum ${param}"), {
                    limit: this._describeArg(table.limit),
                    table: this.describeTable(table.table.table, extraInParams),
                    param: table.schema!.getArgCanonical(table.table.field)
                });
            } else {
                return this._interp(this._("the ${limit} ${table} with the maximum ${param}"), {
                    limit: this._describeArg(table.limit),
                    table: this.describeTable(table.table.table, extraInParams),
                    param: table.schema!.getArgCanonical(table.table.field)
                });
            }
        } else if (table instanceof Ast.SortedTable) {
            if (table.direction === 'asc') {
                return this._interp(this._("the ${table} sorted by increasing ${param}"), {
                    table: this.describeTable(table.table, extraInParams),
                    param: table.schema!.getArgCanonical(table.field)
                });
            } else {
                return this._interp(this._("the ${table} sorted by decreasing ${param}"), {
                    table: this.describeTable(table.table, extraInParams),
                    param: table.schema!.getArgCanonical(table.field)
                });
            }
        } else if (table instanceof Ast.IndexTable && table.indices.length === 1) {
            return this._describeIndex(table.indices[0],
                this.describeTable(table.table, extraInParams));
        } else if (table instanceof Ast.IndexTable) {
            return this._interp(this._("${indices.length:plural:\
                one {element ${indices} of the ${table}}\
                other {elements ${indices} of the ${table}}\
            }"), {
                indices: this._describeArg(new Ast.Value.Array(table.indices)),
                table: this.describeTable(table.table, extraInParams),
            });
        } else if (table instanceof Ast.SlicedTable) {
            return this._interp(this._("${base:plural:\
                =1 {the first ${limit} ${table}}\
                =-1 {the last ${limit} ${table}}\
                other {${limit} elements starting from ${base} of the ${table}}\
            }"), {
                limit: this._describeArg(table.limit),
                base: this._describeArg(table.base),
                table: this.describeTable(table.table, extraInParams),
            });
        } else if (table instanceof Ast.JoinTable) {
            const lhsParams = extraInParams.filter((p) => p.name in table.lhs.schema!.inReq || p.name in table.lhs.schema!.inOpt);
            const rhsParams = extraInParams.filter((p) => p.name in table.rhs.schema!.inReq || p.name in table.rhs.schema!.inOpt);

            return this._interp(this._("${lhs} and ${rhs}"), {
                lhs: this.describeTable(table.lhs, lhsParams),
                rhs: this.describeTable(table.rhs, rhsParams.concat(table.in_params))
            });
        } else {
            throw new TypeError();
        }
    }

    private __describeArgList(args : string[], schema : Ast.ExpressionSignature) {
        return args.map((argname) => schema.getArgCanonical(argname));
    }

    describeStream(stream : Ast.Stream) : string {
        if (stream instanceof Ast.VarRefStream) {
            return clean(stream.name);
        } else if (stream instanceof Ast.TimerStream) {
            return this._interp(this._("${frequency:plural:\
                =1 {every ${interval}}\
                =2 {twice every ${interval}}\
                other {${frequency} times every ${interval}}\
            }${? starting ${base}}"), {
                frequency: stream.frequency !== null ? this._describeArg(stream.frequency) : 1,
                interval: this._describeArg(stream.interval),
                base: stream.base instanceof Ast.DateValue && stream.base.value === null ? null : this._describeArg(stream.base)
            });
        } else if (stream instanceof Ast.AtTimerStream) {
            return this._interp(this._("every day at ${times}${? until ${expiration}}"), {
                times: stream.time.map((t) => this._describeArg(t)),
                expiration: stream.expiration_date !== null ? this._describeArg(stream.expiration_date) : null
            });
        } else if (stream instanceof Ast.MonitorStream) {
            if (stream.table instanceof Ast.FilteredTable) {
                // flip monitor of filter to filter of monitor
                return this._interp(this._("${is_list:select:\
                    true {when ${table} change if ${filter}}\
                    false {when ${table} changes if ${filter}}\
                }"), {
                    is_list: stream.table.schema!.is_list,
                    table: this.describeTable(stream.table.table, []),
                    filter: this.describeFilter(stream.table.filter, stream.table.schema)
                });
            } else {
                return this._interp(this._("${is_list:select:\
                    true {when ${table} change}\
                    false {when ${table} changes}\
                }"), {
                    is_list: stream.table.schema!.is_list,
                    table: this.describeTable(stream.table, []),
                });
            }
        } else if (stream instanceof Ast.EdgeNewStream) {
            // XXX weird
            return this._interp(this._("${stream} and the result changes"), {
                stream: this.describeStream(stream.stream)
            });
        } else if (stream instanceof Ast.EdgeFilterStream) {
            return this._interp(this._("${stream} and it becomes true that ${filter}"), {
                stream: this.describeStream(stream.stream),
                filter: this.describeFilter(stream.filter, stream.schema)
            });
        } else if (stream instanceof Ast.FilteredStream) {
            return this._interp(this._("${stream} and ${filter}"), {
                stream: this.describeStream(stream.stream),
                filter: this.describeFilter(stream.filter, stream.schema)
            });
        } else if (stream instanceof Ast.ProjectionStream) {
            return this._interp(this._("the ${param} of ${stream}"), {
                stream: this.describeStream(stream.stream),
                param: this.__describeArgList(stream.args, stream.schema!),
            });
        } else if (stream instanceof Ast.ComputeStream) {
            return this._interp(this._("${stream} and ${expression}"), {
                stream: this.describeStream(stream.stream),
                expression: this._describeArg(stream.expression)
            });
        } else if (stream instanceof Ast.AliasStream) {
            return this.describeStream(stream.stream);
        } else if (stream instanceof Ast.JoinStream) {
            return this._interp(this._("${stream}, get ${table}"), {
                stream: this.describeStream(stream.stream),
                table: this.describeTable(stream.table, stream.in_params)
            });
        } else {
            throw new TypeError();
        }
    }

    private _describeNotifyAction(action : Ast.NotifyAction) {
        return this._("notify you");
    }

    private _describeAction(action : Ast.Action) {
        if (action instanceof Ast.VarRefAction)
            return clean(action.name);
        else if (action instanceof Ast.InvocationAction)
            return this.describePrimitive(action.invocation);
        else if (action instanceof Ast.NotifyAction)
            return this._describeNotifyAction(action);
        else
            throw new TypeError();
    }

    private _describeActionList(actions : Ast.Action[]) {
        return actions.map((a) => this._describeAction(a));
    }

    private _describeRule(r : Ast.Rule|Ast.Command) {
        if (r instanceof Ast.Rule) {
            if (r.stream instanceof Ast.JoinStream) {
                return this._interp(this._("do the following: ${stream}, and then ${actions}"), {
                    stream: this.describeStream(r.stream),
                    actions: this._describeActionList(r.actions),
                });
            } else {
                return this._interp(this._("${actions} ${stream}"), {
                    stream: this.describeStream(r.stream),
                    actions: this._describeActionList(r.actions),
                });
            }
        } else if (r.table !== null) {
            return this._interp(this._("get ${table} and then ${actions}"), {
                table: this.describeTable(r.table, []),
                actions: this._describeActionList(r.actions)
            });
        } else {
            return this._describeActionList(r.actions);
        }
    }

    private _describeAssignment(d : Ast.Assignment) {
        let valuedesc;
        const value = d.value.toLegacy();
        if (value instanceof Ast.Table)
            valuedesc = this.describeTable(value, []);
        else if (value instanceof Ast.Stream)
            valuedesc = this.describeStream(value);
        else if (value instanceof Ast.Action)
            valuedesc = this._describeAction(value);

        return this._interp(this._("let ${name} be ${value}"), {
            name: clean(d.name),
            value: valuedesc
        });
    }

    describeProgram(program : Ast.Program) : string {
        const desc = program.statements.map((r) => {
            if (r instanceof Ast.Assignment)
                return this._describeAssignment(r);
            else
                return this._describeRule(r.toLegacy());
        }).join('; ');
        if (program.principal) {
            return this._interp(this._("tell ${principal}: ${command}"), {
                principal: this._describeArg(program.principal),
                command: desc
            });
        } else {
            return desc;
        }
    }

    describePermissionFunction(permissionFunction : Ast.PermissionFunction,
                               functionType : 'query'|'action',
                               scope : ScopeMap) : string {
        if (permissionFunction instanceof Ast.SpecifiedPermissionFunction) {
            const kind = permissionFunction.kind;
            const schema = permissionFunction.schema as Ast.FunctionDef;

            let confirm = schema.confirmation!;
            const argMap = new Map;
            argMap.set('__device', [clean(kind), -1]);

            let filterClone = permissionFunction.filter.clone().optimize();
            let andFilter : Ast.AndBooleanExpression;
            if (!(filterClone instanceof Ast.AndBooleanExpression))
                andFilter = new Ast.BooleanExpression.And(null, [filterClone]);
            else
                andFilter = filterClone;

            andFilter.operands.forEach((operand, i) => {
                // don't traverse Ors or Nots
                if (!(operand instanceof Ast.AtomBooleanExpression))
                    return;
                if (operand.operator !== '==')
                    return;

                const argname = operand.name;
                argMap.set(argname, [this._describeArg(operand.value, scope), i]);
            });

            confirm = interpolate(confirm, (param) => {
                if (argMap.has(param)) {
                    const [desc, index] = argMap.get(param);
                    if (index >= 0)
                        andFilter.operands[index] = Ast.BooleanExpression.True;
                    return desc;
                } else {
                    return this._interp(this._("any ${param}"), { param });
                }
            }, {
                locale: this.locale,
                timezone: this.timezone,
                failIfMissing: false,
                nullReplacement: '____'
            })||'';

            // optimize the modified filter, and see if there is anything left
            filterClone = andFilter.optimize();
            if (!filterClone.isTrue) {
                confirm = this._interp(this._("${confirm} if ${filter}"), {
                    confirm,
                    filter: this.describeFilter(filterClone, schema, scope)
                });
            }

            for (const argname in schema.out)
                scope[argname] = schema.getArgCanonical(argname)!;

            return confirm;
        } else {
            assert(permissionFunction instanceof Ast.ClassStarPermissionFunction);

            // class star
            const kind = permissionFunction.kind;
            if (kind === 'org.thingpedia.builtin.thingengine.builtin') {
                // very weird edge cases...
                switch (functionType) {
                case 'query':
                    return this._("your clock");
                case 'action':
                    return this._("send you messages, configure new accounts and open links");
                }
            }

            switch (functionType) {
            case 'query':
                return this._interp(this._("your ${device}"), { device: capitalize(cleanKind(kind)) });
            case 'action':
                return this._interp(this._("perform any action on your ${device}"), { device: capitalize(cleanKind(kind)) });
            default:
                return '';
            }
        }
    }

    describePermissionRule(permissionRule : Ast.PermissionRule) : string {
        let principal;
        if (permissionRule.principal.isTrue) {
            principal = this._("anyone");
        } else if (permissionRule.principal instanceof Ast.ComputeBooleanExpression &&
            permissionRule.principal.lhs instanceof Ast.EventValue &&
            permissionRule.principal.operator === '==') {
            principal = this._describeArg(permissionRule.principal.rhs);
        } else if (permissionRule.principal instanceof Ast.ComputeBooleanExpression &&
            permissionRule.principal.lhs instanceof Ast.EventValue &&
            permissionRule.principal.operator === 'group_member') {
            principal = this._interp(this._("anyone in the ${group} group"), {
                group: this._describeArg(permissionRule.principal.rhs)
        });
        } else {
            principal = this._interp(this._("if ${filter}, the requester"), {
                filter: this.describeFilter(permissionRule.principal, null)
            });
        }

        const scope : ScopeMap = {};
        if (permissionRule.query.isBuiltin) {
            if (permissionRule.action.isBuiltin) {
                throw new Error();
            } else if (permissionRule.action.isStar) {
                return this._interp(this._("${principal} is allowed to perform any action"), {
                    principal
                });
            } else {
                return this._interp(this._("${principal} is allowed to ${action}"), {
                    principal,
                    action: this.describePermissionFunction(permissionRule.action, 'action', scope)
                });
            }
        } else if (permissionRule.query.isStar) {
            if (permissionRule.action.isBuiltin) {
                return this._interp(this._("${principal} is allowed to read all your data"), {
                    principal
                });
            } else if (permissionRule.action.isStar) {
                return this._interp(this._("${principal} is allowed to read all your data and then perform any action with it"), {
                    principal
                });
            } else {
                return this._interp(this._("${principal} is allowed to read all your data and then use it to ${action}"), {
                    principal,
                    action: this.describePermissionFunction(permissionRule.action, 'action', scope)
                });
            }
        } else {
            if (permissionRule.action.isBuiltin) {
                return this._interp(this._("${principal} is allowed to read ${query}"), {
                    principal,
                    query: this.describePermissionFunction(permissionRule.query, 'query', scope)
                });
            } else if (permissionRule.action.isStar) {
                return this._interp(this._("${principal} is allowed to read ${query} and then perform any action with it"), {
                    principal,
                    query: this.describePermissionFunction(permissionRule.query, 'query', scope)
                });
            } else {
                return this._interp(this._("${principal} is allowed to read ${query} and then use it to ${action}"), {
                    principal,
                    query: this.describePermissionFunction(permissionRule.query, 'query', scope),
                    action: this.describePermissionFunction(permissionRule.action, 'action', scope)
                });
            }
        }
    }

    private _describeSpecial(specialType : string) {
        switch (specialType) {
            case 'yes':
                return this._("yes");
            case 'no':
                return this._("no");
            case 'failed':
                return this._("I did not understand");
            case 'train':
                return this._("train me again");
            case 'back':
                return this._("go back");
            case 'more':
                return this._("show more results");
            case 'empty':
                return this._("no action");
            case 'debug':
                return this._("show debugging information");
            case 'maybe':
                return this._("maybe");
            case 'nevermind':
                return this._("cancel");
            case 'stop':
                return this._("stop");
            case 'help':
                return this._("help");
            case 'makerule':
                return this._("make a new command");
            case 'wakeup':
                return this._("wake up");
            default:
                return clean(specialType);
        }
    }

    private _describeControlCommand(input : Ast.ControlCommand) : string {
        const intent = input.intent;
        if (intent instanceof Ast.SpecialControlIntent) {
            return this._describeSpecial(intent.type);
        } else if (intent instanceof Ast.ChoiceControlIntent) {
            return this._interp(this._("choice number ${choice}"), {
                choice: intent.value+1
            })||'';
        } else if (intent instanceof Ast.AnswerControlIntent) {
            return this.describeArg(intent.value);
        } else {
            throw new TypeError();
        }
    }

    describe(input : Ast.Input) : string {
        if (input instanceof Ast.Program)
            return this.describeProgram(input);
        else if (input instanceof Ast.PermissionRule)
            return this.describePermissionRule(input);
        else if (input instanceof Ast.ControlCommand)
            return this._describeControlCommand(input);
        else
            throw new TypeError(`Unrecognized input type ${input}`);
    }
}

function capitalize(str : string) : string {
    return str.split(/\s+/g).map((word) => word[0].toUpperCase() + word.substring(1)).join(' ');
}

function capitalizeSelector(prim : Ast.Invocation|{ name : string }) : string {
    if (prim instanceof Ast.Invocation)
        return doCapitalizeSelector(prim.selector.kind, prim.channel);
    else
        return clean(prim.name);
}

function doCapitalizeSelector(kind : string, channel : string) {
    kind = cleanKind(kind);

    if (kind === 'builtin' || kind === 'remote' || kind.startsWith('__dyn_'))
        return capitalize(clean(channel));
    else
        return capitalize(kind);
}

export function getProgramName(program : Ast.Program) : string {
    const descriptions : string[] = [];
    for (const [,prim] of program.iteratePrimitives(true)) {
        if (prim instanceof Ast.ExternalBooleanExpression)
            continue;
        if (prim instanceof Ast.FunctionCallExpression &&
            (prim.name === 'timer' || prim.name === 'attimer'))
            continue;
        descriptions.push(capitalizeSelector(prim));
    }
    return descriptions.join(" ⇒ ");
}
