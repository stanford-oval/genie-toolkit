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
import { Ast, Type, Syntax } from 'thingtalk';

import * as I18n from '../../i18n';
import { clean, cleanKind } from '../misc-utils';
import { splitParams, tokenizeExample } from './example-utils';
import { AnyEntity } from '../entity-utils';

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

interface LocationLike {
    lat : number;
    lon : number;
    display ?: string|null;
}

type InterpChunkPrimitive = string|number|boolean|null|undefined|LocationLike;
type InterpChunk = InterpChunkPrimitive|InterpChunkPrimitive[];


export class Describer {
    private _ : (x : string) => string;
    locale : string;
    timezone : string|undefined;

    private _langPack : I18n.LanguagePack;
    private _entityAllocator : Syntax.SequentialEntityAllocator;
    private _direction : 'user'|'agent';
    private _format : InstanceType<typeof interpolate.Formatter>; // FIXME
    private _interp : (x : string, args : Record<string, InterpChunk|InterpChunk[]>) => string;

    private _datasets : Map<string, Ast.Dataset> = new Map;

    constructor(locale : string,
                timezone : string|undefined,
                entityAllocator : Syntax.SequentialEntityAllocator,
                direction : 'user'|'agent' = 'user') {
        this._langPack = I18n.get(locale);
        this._entityAllocator = entityAllocator;
        this._ = this._langPack.gettext;
        this.locale = locale;
        this.timezone = timezone;

        this._direction = direction;
        this._format = new interpolate.Formatter(locale, timezone);
        this._interp = (string, args) => interpolate(string, args, { locale, timezone })||'';
    }

    setDataset(kind : string, dataset : Ast.Dataset) {
        this._datasets.set(kind, dataset);
    }

    setFullDataset(datasets : Ast.Dataset[]) {

        // flatten all examples in all datasets, and then split again by device
        // split the dataset into multiple datasets for each kind
        // to have a faster lookup when we describe a specific program later

        const examples = new Map<string, Ast.Example[]>();

        for (const dataset of datasets) {
            for (const example of dataset.examples) {
                const devices = new Set<string>();
                for (const [, prim] of example.iteratePrimitives(false))
                    devices.add(prim.selector.kind);
                for (const device of devices) {
                    const list = examples.get(device);
                    if (list)
                        list.push(example);
                    else
                        examples.set(device, [example]);
                }
            }
        }

        for (const [kind, list] of examples) {
            const newDataset = new Ast.Dataset(null, kind, list);
            this._datasets.set(kind, newDataset);
        }
    }

    private _displayLocation(loc : Ast.Location) {
        if (loc instanceof Ast.AbsoluteLocation || loc instanceof Ast.UnresolvedLocation) {
            return this._getEntity('LOCATION', loc.toEntity());
        } else {
            assert(loc instanceof Ast.RelativeLocation);
            switch (loc.relativeTag) {
            case 'current_location':
                return this._("here");
            case 'home':
                return this._("home");
            case 'work':
                return this._("work");
            default:
                return loc.relativeTag;
            }
        }
    }

    private _getEntity(entityType : string, entity : AnyEntity) : string {
        return this._entityAllocator.findEntity(entityType, entity).flatten().join(' ');
    }

    private _describeTime(time : Ast.Time) {
        if (time instanceof Ast.AbsoluteTime) {
            return this._getEntity('TIME', time.toEntity());
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
            base = this._interp(this._("${time} on day ${day} of ${month} , ${year}"),
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
            return this._getEntity('DATE', date);
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
    private _describeArg(arg : Ast.Value, scope : ScopeMap = {}, skipThePrefix = false) : InterpChunk {
        if (arg instanceof Ast.ArrayValue)
            return arg.value.map((v) => this._describeArg(v, scope) as InterpChunkPrimitive);

        if (arg instanceof Ast.NumberValue)
            return this._getEntity('NUMBER', arg.value);

        if (arg instanceof Ast.VarRefValue) {
            let name;
            if (arg.name in scope)
                name = scope[arg.name];
            else
                name = clean(arg.name);
            if (skipThePrefix)
                return name;
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

            const operands : InterpChunk[] = arg.operands.map((v) => this._describeArg(v, scope));
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
            return this._getEntity('QUOTED_STRING', arg.value);
        if (arg instanceof Ast.EntityValue) {
            switch (arg.type) {
            case 'tt:url':
                return this._getEntity('URL', arg.value!);
            case 'tt:username':
                return this._getEntity('USERNAME', arg.value!);
            case 'tt:hashtag':
                return this._getEntity('HASHTAG', arg.value!);
            case 'tt:phone_number':
                return this._getEntity('PHONE_NUMBER', arg.value!);
            case 'tt:email_address':
                return this._getEntity('EMAIL_ADDRESS', arg.value!);
            case 'tt:path_name':
                return this._getEntity('PATH_NAME', arg.value!);
            case 'tt:picture':
                return this._getEntity('PICTURE', arg.value!);
            default:
                return this._getEntity('GENERIC_ENTITY_' + arg.type, arg.toEntity());
            }
        }
        if (arg instanceof Ast.CurrencyValue)
            return this._getEntity('CURRENCY', arg.toEntity());
        if (arg instanceof Ast.EnumValue)
            return clean(arg.value);
        if (arg instanceof Ast.MeasureValue) {
            const normalizedUnit = new Type.Measure(arg.unit).unit;
            return this._getEntity('MEASURE_' + normalizedUnit, arg.toEntity());
        }
        if (arg instanceof Ast.BooleanValue)
            return arg.value ? this._("true") : this._("false");
        if (arg instanceof Ast.DateValue)
            return this._describeDate(arg.value);
        if (arg instanceof Ast.TimeValue)
            return this._describeTime(arg.value);

        return String(arg);
    }

    private _describeOperator(argcanonical : InterpChunk,
                              op : string,
                              value : InterpChunk,
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
        const localschema = new Ast.FunctionDef(null, 'query', null, '', [], {
            is_list: false, is_monitorable: false }, args);
        return localschema;
    }

    private _describeAtomFilter(expr : Ast.AtomBooleanExpression|Ast.ComputeBooleanExpression,
                                schema : Ast.FunctionDef|null,
                                scope : ScopeMap,
                                negate : boolean,
                                canonical_overwrite : ScopeMap = {}) {
        let lhs : InterpChunk, rhs : InterpChunk, ptype : Type;
        if (expr instanceof Ast.AtomBooleanExpression) {
            const argname = expr.name;
            if (argname in canonical_overwrite) {
                lhs = canonical_overwrite[argname];
            } else if (schema) {
                if (schema.hasArgument(argname))
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
                   schema : Ast.FunctionDef|null = null,
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
                    if (schema.hasArgument(argname))
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

                const primdesc = this.describePrimitive(expr, scope);

                if (expr.filter instanceof Ast.AtomBooleanExpression) {
                    // common case
                    const lhs = this._interp(this._("the ${param} of the ${expr}"), {
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
                    const lhs = this._interp(this._("the ${param} of the ${expr}"), {
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
                    return this._interp(this._("for the ${expr} , ${filter}"), {
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

    private _getDeviceAttribute(selector : Ast.DeviceSelector, name : string) : InterpChunk|undefined {
        for (const attr of selector.attributes) {
            if (attr.name === name)
                return this._describeArg(attr.value, {});
        }
        return undefined;
    }

    private _computeParamMatchingScore(exampleInParams : Ast.InputParam[],
                                       programInParams : Ast.InputParam[],
                                       exampleArgs : Record<string, Type>) {
        let score = 0;
        const missing = new Set<string>();
        for (const in_param2 of programInParams) {
            if (in_param2.value instanceof Ast.UndefinedValue)
                continue;
            missing.add(in_param2.name);
        }
        for (const in_param of exampleInParams) {
            let found = false;
            for (const in_param2 of programInParams) {
                if (in_param2.value instanceof Ast.UndefinedValue)
                    continue;

                if (in_param2.name === in_param.name) {
                    // found it!
                    if (in_param.value.equals(in_param2.value)) {
                        // exact value match (mostly for enums)
                        score += 2;
                    } else if (in_param.value instanceof Ast.VarRefValue &&
                               in_param.value.name in exampleArgs) {
                        // normal match (map to a placeholder and replace)
                        score += 1;
                    } else {
                        // no match at all, break out of here!
                        break;
                    }

                    found = true;
                    missing.delete(in_param2.name);
                    break;
                }
            }
            if (!found) {
                if (in_param.value instanceof Ast.VarRefValue &&
                    in_param.value.name in exampleArgs) {
                    // the parameter is mentioned in the example utterance but not
                    // in the program we're describing, so we'll have to
                    // use a placeholder
                    // lower the score
                    score -= 0.5;
                } else if (!(in_param.value instanceof Ast.UndefinedValue)) {
                    return null;
                }
            }
        }

        for (const _ of missing) {
            // this parameter ais specified but not present in the example
            // so we'll have to append a clause
            // this is not as good, so lower the score a bit
            score -= 0.1;
        }

        return score;
    }

    private _findBestExampleUtterance(kind : string,
                                      functionName : string,
                                      forSelector : Ast.DeviceSelector|null,
                                      forInParams : Ast.InputParam[],
                                      forSchema : Ast.FunctionDef) {
        const dataset = this._datasets.get(kind);

        let relevantExamples : Ast.Example[] = [];
        if (dataset) {
            relevantExamples = dataset.examples.filter((ex) => {
                if (!(ex.value instanceof Ast.InvocationExpression))
                    return false;
                const invocation = ex.value.invocation;

                return invocation.selector.kind === kind && invocation.channel === functionName;
            });
        }

        const templates : Array<{ utterance : string, score : number }> = [];

        // map each example from a form with p_ parameters into a "confirmation"-like form
        for (const ex of relevantExamples) {
            if (!ex.preprocessed || ex.preprocessed.length === 0) {
                // preprocess here...
                const tokenizer = this._langPack.getTokenizer();
                ex.preprocessed = ex.utterances.map((utterance : string) => tokenizeExample(tokenizer, utterance, ex.id));
            }

            const expression = ex.value;
            assert(expression instanceof Ast.InvocationExpression);
            const invocation = expression.invocation;

            // score this example depending on how well it matches the invocation
            // we're trying to describe
            if (invocation.selector.all &&
                (!forSelector || !forSelector.all))
                continue;
            if (forSelector && forSelector.all && !invocation.selector.all)
                continue;

            let score = this._computeParamMatchingScore(invocation.in_params,
                                                        forInParams,
                                                        ex.args);
            if (score === null)
                continue;

            let deviceNameParam = null;
            if (invocation.selector.attributes.length > 0 &&
                invocation.selector.attributes[0].name === 'name') {
                /* we have a device name */
                assert(invocation.selector.attributes[0].value instanceof Ast.VarRefValue);
                deviceNameParam = invocation.selector.attributes[0].value.name;

                if (forSelector && forSelector.id)
                    score += 1; // normal match
                else
                    score -= 0.5; // placeholder
            } else if (forSelector && forSelector.id) {
                // missing a space to put a device name (and we won't append
                // the device name later) so this is bad
                //
                // note that if this device belongs to a single-instance class
                // all examples get this negative score so it doesn't matter
                score -= 1;
            }

            outerloop: for (let i = 0; i < ex.preprocessed.length; i++) {
                const preprocessed = ex.preprocessed[i];
                let mapped = '';

                for (const chunk of splitParams(preprocessed)) {
                    if (typeof chunk === 'string') {
                        mapped += chunk;
                        continue;
                    }

                    const [, param1, param2] = chunk;
                    const param = param1 || param2;
                    if (param === deviceNameParam) {
                        mapped += '${__device}';
                        continue;
                    }

                    let found = null;
                    for (const in_param of invocation.in_params) {
                        if (in_param.value instanceof Ast.VarRefValue &&
                            in_param.value.name === param) {
                            found = in_param.name;
                            break;
                        }
                    }
                    if (!found) {
                        // ??? the parameter is used in some weird way, not a good example
                        continue outerloop;
                    }
                    mapped += '${' + found + '}';
                }

                templates.push({ utterance: mapped, score });
            }
        }

        // add the fallback example, with the score it would have as a score
        let canonical = forSchema.metadata.canonical;
        if (!canonical)
            canonical = clean(forSchema.name);
        if (Array.isArray(canonical))
            canonical = canonical[0];
        if (forSchema.functionType === 'query' && forSchema.is_list) {
            const plural = this._langPack.pluralize(canonical);
            if (plural)
                canonical = plural;
        }
        // put the canonical form first in the order
        // so all things equal, we'll pick the canonical form (which is, well, canonical)
        templates.unshift({
            utterance: canonical,
            score: this._computeParamMatchingScore([], forInParams, {})!
                + (forSelector && forSelector.id ? -1 : 0)
        });

        // sort the templates by score, pick the highest one
        templates.sort((one, two) => two.score - one.score);
        return templates[0].utterance;
    }


    describePrimitive(obj : Ast.Invocation|Ast.ExternalBooleanExpression|Ast.FunctionCallExpression,
                      scope ?: ScopeMap) : string {
        const schema = obj.schema;
        assert(schema instanceof Ast.FunctionDef);

        const argMap = new Map;
        let confirm : string;
        if (obj instanceof Ast.FunctionCallExpression)
            confirm = schema.canonical!;
        else
            confirm = this._findBestExampleUtterance(obj.selector.kind, obj.channel, obj.selector, obj.in_params, obj.schema!);

        if (this._direction === 'agent')
            confirm = this._langPack.toAgentSideUtterance(confirm);

        if (obj instanceof Ast.Invocation ||
            obj instanceof Ast.ExternalBooleanExpression) {
            const cleanKind = schema.class ? schema.class.canonical : clean(obj.selector.kind);
            const name = this._getDeviceAttribute(obj.selector, 'name');
            if (name)
                argMap.set('__device', name);
            else
                argMap.set('__device', cleanKind);
        }

        for (const inParam of obj.in_params) {
            const argname = inParam.name;
            if (inParam.value.isUndefined)
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

        for (const inParam of obj.in_params) {
            const argname = inParam.name;
            if (usedArgs.has(argname))
                continue;

            if (argname.startsWith('__'))
                continue;
            const arg = schema.getArgument(argname)!;
            if (inParam.value.isUndefined && arg.required)
                continue;

            let canonical;
            if (!arg.metadata.canonical)
                canonical = { base: [clean(argname)] };
            else if (typeof arg.metadata.canonical === 'string')
                canonical = { base: [arg.metadata.canonical] };
            else
                canonical = arg.metadata.canonical;

            if (!canonical.default)
                canonical.default = 'base';
            if (canonical.default in NEW_ANNOTATION_RENAME)
                canonical.default = NEW_ANNOTATION_RENAME[canonical.default];

            let canonical_key = canonical.default;
            let form;
            if (canonical_key === 'implicit_identity') {
                canonical_key = 'reverse_property';
                form = '#';
            } else {
                if (canonical[canonical.default])
                    form = canonical[canonical.default];
                else if (canonical[OLD_ANNOTATION_RENAME[canonical.default]])
                    form = canonical[OLD_ANNOTATION_RENAME[canonical.default]];
                if (Array.isArray(form))
                    form = form[0];
            }
            assert(typeof form === 'string');

            let value = this._describeArg(inParam.value, scope);
            if (Array.isArray(value)) {
                value = this._format.listToString(value, {
                    type: 'conjunction'
                });
            }
            let input_param;
            if (form.indexOf('#') >= 0)
                input_param = form.replace('#', String(value));
            else
                input_param = form + ' ' + value;

            if (firstExtra) {
                confirm = this._interp(this._("${canonical_key:select: \
                    base {${invocation} with ${input_param}} \
                    property {${invocation} that have ${input_param}} \
                    reverse_property {${invocation} that are ${input_param}}\
                    verb {${invocation} that ${input_param}} \
                    adjective {${input_param} ${invocation}} \
                    passive_verb {${invocation} ${input_param}} \
                    preposition {${invocation} ${input_param}} \
                }"), { canonical_key: canonical.default, invocation: confirm, input_param });

                if (!['adjective', 'passive_verb'].includes(canonical.default))
                    firstExtra = false;
            } else {
                confirm = this._interp(this._("${canonical_key:select: \
                    base {${invocation} and with ${input_param}} \
                    property {${invocation} and have ${input_param}} \
                    reverse_property {${invocation} and are ${input_param}}\
                    verb {${invocation} and ${input_param}} \
                    adjective {${input_param} ${table}} \
                    passive_verb {${invocation} ${input_param}} \
                    preposition {${invocation} ${input_param}} \
                }"), { canonical_key, invocation: confirm, input_param });
            }
        }

        return confirm;
    }

    private _describeIndex(index : Ast.Value, tabledesc : string) {
        if (index instanceof Ast.NumberValue) {
            if (index.value < 0) {
                return this._interp(this._("${index:ordinal: \
                    =1 {the last ${query}}\
                    =2 {the second to last ${query}}\
                    one {the ${index}st last ${query}}\
                    two {the ${index}nd last ${query}}\
                    few {the ${index}rd last ${query}}\
                    other {the ${index}th last ${query}}\
                }"), { index: -index.value, query: tabledesc });
            } else {
                return this._interp(this._("${index:ordinal: \
                    =1 {the first ${query}}\
                    =2 {the second ${query}}\
                    =3 {the third ${query}}\
                    one {the ${index}st ${query}}\
                    two {the ${index}nd ${query}}\
                    few {the ${index}rd ${query}}\
                    other {the ${index}th ${query}}\
                }"), { index: index.value, query: tabledesc});
            }
        } else {
            return this._interp(this._("the ${query} with index ${index}"), {
                index: this._describeArg(index),
                query: tabledesc
            });
        }
    }

    private _describeFilteredTable(table : Ast.FilterExpression) : string {
        const inner = this.describeQuery(table.expression);
        if (!table.schema!.is_list) {
            return this._interp(this._("${query} such that ${filter}"), {
                query: inner,
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
            return this._interp(this._("${query} such that ${filter}"), {
                query: tabledesc,
                filter: this.describeFilter(new Ast.BooleanExpression.And(null, otherClauses).optimize(), table.schema)
            });
        } else {
            return tabledesc;
        }
    }

    describeQuery(table : Ast.Expression) : string {
        if (table instanceof Ast.FunctionCallExpression) {
            return this.describePrimitive(table);
        } else if (table instanceof Ast.InvocationExpression) {
            return this.describePrimitive(table.invocation, {});
        } else if (table instanceof Ast.FilterExpression) {
            return this._describeFilteredTable(table);
        } else if (table instanceof Ast.ProjectionExpression) {
            return this._interp(this._("the ${param} of ${query}"), {
                query: this.describeQuery(table.expression),
                param: this.__describeArgList(table.args, table.computations, table.schema!)
            });
        } else if (table instanceof Ast.AliasExpression) {
            return this.describeQuery(table.expression);
        } else if (table instanceof Ast.AggregationExpression) {
            if (table.field === '*') {
                return this._interp(this._("the number of ${query}"), {
                    query: this.describeQuery(table.expression)
                });
            }

            let desc;
            switch (table.operator) {
            case 'avg':
                desc = this._("the average ${param} in ${query}");
                break;
            case 'min':
                desc = this._("the minimum ${param} in ${query}");
                break;
            case 'max':
                desc = this._("the maximum ${param} in ${query}");
                break;
            case 'sum':
                desc = this._("the sum of the ${param} in ${query}");
                break;
            case 'count':
                desc = this._("the number of ${param}s in ${query}");
                break;
            default:
                throw new TypeError(`Invalid aggregation ${table.operator}`);
            }
            return this._interp(desc, {
                param: table.schema!.getArgCanonical(table.field),
                query: this.describeQuery(table.expression)
            });

        // recognize argmin/argmax
        } else if (table instanceof Ast.IndexExpression && table.indices.length === 1 && table.indices[0] instanceof Ast.NumberValue &&
            table.expression instanceof Ast.SortExpression &&
            (table.indices[0].toJS() === 1 || table.indices[0].toJS() === -1)) {
            const index = table.indices[0] as Ast.NumberValue;

            if ((index.value === 1 && table.expression.direction === 'asc') ||
                (index.value === -1 && table.expression.direction === 'desc')) {
                return this._interp(this._("the ${query} with the minimum ${param}"), {
                    query: this.describeQuery(table.expression.expression),
                    param: this._describeArg(table.expression.value, {}, true)
                });
            } else {
                return this._interp(this._("the ${query} with the maximum ${param}"), {
                    query: this.describeQuery(table.expression.expression),
                    param: this._describeArg(table.expression.value, {}, true)
                });
            }

        // recognize argmin/argmax top K
        } else if (table instanceof Ast.SliceExpression && table.expression instanceof Ast.SortExpression &&
            table.base instanceof Ast.NumberValue &&
            (table.base.value === 1 || table.base.value === -1)) {
                if ((table.base.value === 1 && table.expression.direction === 'asc') ||
                    (table.base.value === -1 && table.expression.direction === 'desc')) {
                return this._interp(this._("the ${limit} ${query} with the minimum ${param}"), {
                    limit: this._describeArg(table.limit),
                    query: this.describeQuery(table.expression.expression),
                    param: this._describeArg(table.expression.value, {}, true)
                });
            } else {
                return this._interp(this._("the ${limit} ${query} with the maximum ${param}"), {
                    limit: this._describeArg(table.limit),
                    query: this.describeQuery(table.expression.expression),
                    param: this._describeArg(table.expression.value, {}, true)
                });
            }
        } else if (table instanceof Ast.SortExpression) {
            if (table.direction === 'asc') {
                return this._interp(this._("the ${query} sorted by increasing ${param}"), {
                    query: this.describeQuery(table.expression),
                    param: this._describeArg(table.value, {}, true)
                });
            } else {
                return this._interp(this._("the ${query} sorted by decreasing ${param}"), {
                    query: this.describeQuery(table.expression),
                    param: this._describeArg(table.value, {}, true)
                });
            }
        } else if (table instanceof Ast.IndexExpression && table.indices.length === 1) {
            return this._describeIndex(table.indices[0],
                this.describeQuery(table.expression));
        } else if (table instanceof Ast.IndexExpression) {
            return this._interp(this._("${indices.length:plural:\
                one {element ${indices} of the ${query}}\
                other {elements ${indices} of the ${query}}\
            }"), {
                indices: this._describeArg(new Ast.Value.Array(table.indices)),
                query: this.describeQuery(table.expression),
            });
        } else if (table instanceof Ast.SliceExpression) {
            const base = table.base.isConstant() ? table.base.toJS() : undefined;
            if (base === 1) {
                return this._interp(this._("the first ${limit} ${query}"), {
                    limit: this._describeArg(table.limit),
                    query: this.describeQuery(table.expression),
                });
            } else if (base === -1) {
                return this._interp(this._("the last ${limit} ${query}"), {
                    limit: this._describeArg(table.limit),
                    query: this.describeQuery(table.expression),
                });
            } else {
                return this._interp(this._("${limit} elements starting from ${base} of the ${query}"), {
                    limit: this._describeArg(table.limit),
                    base: this._describeArg(table.base),
                    query: this.describeQuery(table.expression),
                });
            }
        } else if (table instanceof Ast.ChainExpression) {
            return this._format.listToString(table.expressions.map((t) => this.describeQuery(t)));
        } else {
            throw new TypeError(`Unexpected query ${table.prettyprint()}`);
        }
    }

    private __describeArgList(args : string[],
                              computations : Ast.Value[],
                              schema : Ast.FunctionDef) {
        return args.map((argname) : InterpChunk => schema.getArgCanonical(argname))
            .concat(computations.map((c) => this._describeArg(c)));
    }

    private _describeTimer(stream : Ast.FunctionCallExpression) {
        const frequency = stream.in_params.find((ip) => ip.name === 'frequency');
        const interval = stream.in_params.find((ip) => ip.name === 'interval');
        const base = stream.in_params.find((ip) => ip.name === 'base');

        if (base && !base.value.isUndefined && !(base.value instanceof Ast.DateValue && base.value.value === null)) {
            return this._interp(this._("${frequency:plural:\
                =1 {every ${interval}}\
                =2 {twice every ${interval}}\
                other {${frequency} times every ${interval}}\
            } starting ${base}"), {
                frequency: frequency ? this._describeArg(frequency.value) : 1,
                interval: this._describeArg(interval ? interval.value : new Ast.Value.Undefined()),
                base: this._describeArg(base.value)
            });
        } else {
            return this._interp(this._("${frequency:plural:\
                =1 {every ${interval}}\
                =2 {twice every ${interval}}\
                other {${frequency} times every ${interval}}\
            }"), {
                frequency: frequency ? this._describeArg(frequency.value) : 1,
                interval: this._describeArg(interval ? interval.value : new Ast.Value.Undefined()),
            });
        }
    }

    private _describeAtTimer(stream : Ast.FunctionCallExpression) {
        const time = stream.in_params.find((ip) => ip.name === 'time');
        const expiration_date = stream.in_params.find((ip) => ip.name === 'expiration_date');

        if (expiration_date) {
            return this._interp(this._("every day at ${time} until ${expiration}"), {
                time: this._describeArg(time ? time.value : new Ast.Value.Undefined()),
                expiration: this._describeArg(expiration_date.value)
            });
        } else {
            return this._interp(this._("every day at ${time}"), {
                time: this._describeArg(time ? time.value : new Ast.Value.Undefined()),
            });
        }
    }

    describeStream(stream : Ast.Expression) : string {
        if (stream instanceof Ast.FunctionCallExpression) {
            if (stream.name === 'timer')
                return this._describeTimer(stream);
            else if (stream.name === 'attimer')
                return this._describeAtTimer(stream);
            else
                return this.describePrimitive(stream);
        } else if (stream instanceof Ast.MonitorExpression) {
            if (stream.expression instanceof Ast.FilterExpression) {
                // flip monitor of filter to filter of monitor
                // FIXME is this the right thing to do? not sure
                return this._interp(this._("${is_list:select:\
                    true {when ${table} change if ${filter}}\
                    false {when the ${table} changes if ${filter}}\
                }"), {
                    is_list: stream.expression.schema!.is_list,
                    table: this.describeQuery(stream.expression.expression),
                    filter: this.describeFilter(stream.expression.filter, stream.expression.schema)
                });
            } else {
                return this._interp(this._("${is_list:select:\
                    true {when ${table} change}\
                    false {when the ${table} changes}\
                }"), {
                    is_list: stream.expression.schema!.is_list,
                    table: this.describeQuery(stream.expression),
                });
            }
        } else if (stream instanceof Ast.FilterExpression) {
            return this._interp(this._("${stream} and it becomes true that ${filter}"), {
                stream: this.describeStream(stream.expression),
                filter: this.describeFilter(stream.filter, stream.schema)
            });
        } else if (stream instanceof Ast.ProjectionExpression) {
            // FIXME should flip projection of a monitor and push down to a table
            // (only when describing)
            return this._interp(this._("${stream} , the ${param}"), {
                stream: this.describeStream(stream.expression),
                param: this.__describeArgList(stream.args, stream.computations, stream.schema!),
            });
        } else if (stream instanceof Ast.AliasExpression) {
            return this.describeStream(stream.expression);
        } else {
            throw new TypeError(`Unexpected stream ${stream.prettyprint()}`);
        }
    }

    describeAction(action : Ast.Expression) : string {
        if (action instanceof Ast.FunctionCallExpression)
            return clean(action.name);
        else if (action instanceof Ast.InvocationExpression)
            return this.describePrimitive(action.invocation);
        else
            throw new TypeError(`Unexpected action ${action.prettyprint()}`);
    }

    private _describeExpression(exp : Ast.Expression) {
        if (exp.schema!.functionType === 'query') {
            if (exp.schema!.is_list)
                return this._interp(this._("get ${query}"), { query: this.describeQuery(exp) });
            else
                return this._interp(this._("get the ${query}"), { query: this.describeQuery(exp) });
        } else {
            return this.describeAction(exp);
        }
    }

    describeExpressionStatement(r : Ast.ExpressionStatement) : string {
        const expressions = r.expression.expressions;

        const stream = r.stream;
        if (stream) {
            if (expressions.length > 2) {
                const descriptions = expressions.slice(1).map((exp) => this._describeExpression(exp));

                return this._interp(this._("do the following : ${stream} , ${queries} , and then ${action}"), {
                    stream: this.describeStream(stream),
                    queries: descriptions.slice(0, descriptions.length-1),
                    action: descriptions[descriptions.length-1],
                });
            } else if (expressions.length === 2) {
                return this._interp(this._("${action} ${stream}"), {
                    stream: this.describeStream(stream),
                    action: this._describeExpression(expressions[1]),
                });
            } else {
                return this._interp(this._direction === 'agent' ? this._("notify you ${stream}") : this._("notify me ${stream}"), {
                    stream: this.describeStream(stream),
                });
            }
        } else if (expressions.length > 2) {
            const descriptions = expressions.map((exp) => this._describeExpression(exp));
            return this._interp(this._("${queries} , and then ${action}"), {
                queries: descriptions.slice(0, descriptions.length-1),
                action: descriptions[descriptions.length-1]
            });
        } else if (expressions.length === 2) {
            return this._interp(this._("${query} and then ${action}"), {
                query: this._describeExpression(expressions[0]),
                action: this._describeExpression(expressions[1])
            });
        } else {
            return this._describeExpression(expressions[0]);
        }
    }

    private _describeAssignment(d : Ast.Assignment) {
        let valuedesc : string;
        const value = d.value;
        if (value.schema!.functionType === 'query')
            valuedesc = this.describeQuery(value);
        else if (value.schema!.functionType === 'stream')
            valuedesc = this.describeStream(value);
        else
            valuedesc = this.describeAction(value);

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
                return this.describeExpressionStatement(r);
        }).join('; ');
        if (program.principal) {
            return this._interp(this._("tell ${principal} : ${command}"), {
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

            let filterClone = permissionFunction.filter.clone().optimize();
            let andFilter : Ast.AndBooleanExpression;
            if (!(filterClone instanceof Ast.AndBooleanExpression))
                andFilter = new Ast.BooleanExpression.And(null, [filterClone]);
            else
                andFilter = filterClone;

            const argMap = new Map;
            argMap.set('__device', [clean(kind), -1]);
            const pseudoInParams : Ast.InputParam[] = [];
            andFilter.operands.forEach((operand, i) => {
                // don't traverse Ors or Nots
                if (!(operand instanceof Ast.AtomBooleanExpression))
                    return;
                if (operand.operator !== '==')
                    return;

                const argname = operand.name;
                argMap.set(argname, [this._describeArg(operand.value, scope), i]);
                pseudoInParams.push(new Ast.InputParam(null, argname, operand.value));
            });

            let confirm = this._findBestExampleUtterance(kind, permissionFunction.channel, null, pseudoInParams,
                permissionFunction.schema!);

            if (this._direction === 'agent')
                confirm = this._langPack.toAgentSideUtterance(confirm);

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
                    return this._("send you messages , configure new accounts and open links");
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
            principal = this._interp(this._("if ${filter} , the requester"), {
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
                if (permissionRule.query instanceof Ast.SpecifiedPermissionFunction && !permissionRule.query.schema!.is_list) {
                    return this._interp(this._("${principal} is allowed to read the ${query}"), {
                        principal,
                        query: this.describePermissionFunction(permissionRule.query, 'query', scope)
                    });
                } else {
                    return this._interp(this._("${principal} is allowed to read ${query}"), {
                        principal,
                        query: this.describePermissionFunction(permissionRule.query, 'query', scope)
                    });
                }
            } else if (permissionRule.action.isStar) {
                if (permissionRule.query instanceof Ast.SpecifiedPermissionFunction && !permissionRule.query.schema!.is_list) {
                    return this._interp(this._("${principal} is allowed to read the ${query} and then perform any action with it"), {
                        principal,
                        query: this.describePermissionFunction(permissionRule.query, 'query', scope)
                    });
                } else {
                    return this._interp(this._("${principal} is allowed to read ${query} and then perform any action with it"), {
                        principal,
                        query: this.describePermissionFunction(permissionRule.query, 'query', scope)
                    });
                }
            } else {
                if (permissionRule.query instanceof Ast.SpecifiedPermissionFunction && !permissionRule.query.schema!.is_list) {
                    return this._interp(this._("${principal} is allowed to read the ${query} and then use it to ${action}"), {
                        principal,
                        query: this.describePermissionFunction(permissionRule.query, 'query', scope),
                        action: this.describePermissionFunction(permissionRule.action, 'action', scope)
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
