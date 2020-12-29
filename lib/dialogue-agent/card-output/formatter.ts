// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2018-2020 The Board of Trustees of the Leland Stanford Junior University
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

import interpolate from 'string-interp';
import { Type, Ast, SchemaRetriever, Builtin } from 'thingtalk';

import { clean } from '../../utils/misc-utils';
import {
    FORMAT_TYPES,
    FormattedObjectSpec,
    FormattedObject,
    FormattedObjectClass,
    isNull
} from './format_objects';

function isPlainObject(value : unknown) : value is Record<string, unknown> {
    return typeof value === 'object' && value !== null &&
        (Object.getPrototypeOf(value) === null ||
         Object.getPrototypeOf(value) === Object.prototype);
}

// Heuristics for default formatting, coming from Brassau

const HARDCODED_OUTPUT_PARAM_IMPORTANCE : { [key : string] : number } = {
    id: 100, // ID should be first

    video_id: 50,
    image: 50,
    picture_url: 50,

    uber_type: 11.6,
    low_estimate: 11.5,
    description: 9.9,
    translated_text: 10.5,
    // String: 10
    from: 9.5,
    in_reply_to: 9,

    name: -100, // name duplicates ID
};
const OUTPUT_PARAM_IMPORTANCE_BY_TYPE : { [key : string] : number } = {
    'Entity(tt:picture)': 20,
    'Entity(tt:email_address)': 12,
    'Entity(tt:phone_number)': 12,
    'Entity': 11.5,
    'Measure': 11,
    'Currency': 11,
    'Location': 11,
    'String': 10,
    'Date': 9,
    'Number': 5,
    'Array': -15,
    'Entity(sportradar:eu_soccer_team)': -20,
    'Entity(sportradar:us_soccer_team)': -20,
    'Entity(sportradar:nba_team)': -20,
    'Entity(sportradar:mlb_team)': -20,
    'Entity(sportradar:ncaafb_team)': -20,
    'Entity(sportradar:ncaambb_team)': -20,
    'Entity(instagram:media_id)': -20
};

/**
 * Namespace for format objects.
 *
 * Classes in this namespace are not accessible directly, but objects
 * of this classes are returned by {@link Formatter} methods.
 *
 * @name FormatObjects
 * @namespace
 */

type PlainObject = { [key : string] : unknown };

interface TextSpec {
    type : 'text';
    text : string;
}

type FormatSpecChunk = string | FormattedObjectSpec | TextSpec;
export type FormatSpec = FormatSpecChunk[];
export type FormattedChunk = string | FormattedObject;

interface InternalFormattedChunk {
    formatted : FormattedChunk;
    isPrefix : boolean;
    importance : number;
}

/**
 * An object that is able to convert structured ThingTalk results
 * into something suitable for display to the user.
 */
export class Formatter extends interpolate.Formatter {
    private _schemas : SchemaRetriever;
    private _interp : (template : string, args : any) => string;
    private _ : (key : string) => string;

    /**
     * Construct a new formatter.
     *
     * @param {string} locale - the user's locale, as a BCP47 tag
     * @param {string} timezone - the user's timezone, as a string in the IANA timezone database (e.g. America/Los_Angeles, Europe/Rome)
     * @param {SchemaRetriever} schemaRetriever - the interface to access Thingpedia for formatting information
     * @param {Gettext} [gettext] - gettext instance; this is optional if {@link I18n.init} has been called
     */
    constructor(locale : string,
                timezone : string,
                schemaRetriever : SchemaRetriever,
                gettext : (x : string) => string) {
        super(locale, timezone);
        this._schemas = schemaRetriever;
        this._interp = (string, args) => interpolate(string, args, { locale, timezone })||'';
        this._ = gettext;
    }

    private _displayKey(key : string, functionDef : Ast.FunctionDef|null) : string {
        let buf = '';
        const split = key.split(/\./g);
        let first = true;

        for (const part of split) {
            if (first) {
                buf = this._displayKeyPart(part, functionDef);
                first = false;
            } else {
                buf = this._interp(this._("${key} of ${rest}"), {
                    key: this._displayKeyPart(part, functionDef),
                    rest: buf
                });
            }
        }

        return buf;
    }

    private _displayKeyPart(key : string, functionDef : Ast.FunctionDef|null) : string {
        if (functionDef === null)
            return clean(key);

        if (key === 'geo') {
            if (!functionDef.hasArgument(key))
                console.log(functionDef);
            else
                console.log(functionDef.getArgCanonical(key));
            return 'address';
        }

        if (functionDef.hasArgument(key)) {
            const canonical = functionDef.getArgCanonical(key);
            if (canonical)
                return canonical;
        }
        return clean(key);
    }

    _replaceInString(str : unknown, argMap : PlainObject) : string|null {
        if (typeof str !== 'string')
            return null;

        const replaced = interpolate(str, argMap, {
            locale: this._locale,
            timezone: this._timezone,
            nullReplacement: this._("N/A")
        });
        if (replaced === undefined)
            return null;
        return replaced;
    }

    private async _getFunctionDef(outputType : string|null) : Promise<Ast.FunctionDef|null> {
        if (outputType === null)
            return null;
        const [kind, function_name] = outputType.split(':');
        return this._schemas.getMeta(kind, 'query', function_name);
    }

    private _getArgImportance(fullArgName : string, functionDef : Ast.FunctionDef|null) : number {
        const dot = fullArgName.lastIndexOf('.');
        const argname = fullArgName.substring(dot+1, fullArgName.length);

        if (argname in HARDCODED_OUTPUT_PARAM_IMPORTANCE)
            return HARDCODED_OUTPUT_PARAM_IMPORTANCE[argname];

        const arg = functionDef !== null ? functionDef.getArgument(fullArgName) : null;
        if (!arg)
            return 0;

        if (arg.type.isArray)
            return OUTPUT_PARAM_IMPORTANCE_BY_TYPE.Array;
        if (arg.type.isMeasure)
            return OUTPUT_PARAM_IMPORTANCE_BY_TYPE.Array;

        if (arg)
            return OUTPUT_PARAM_IMPORTANCE_BY_TYPE[String(arg.type)] || 0;

        return 0;
    }

    private _formatFallbackValue(key : string,
                                 value : unknown,
                                 functionDef : Ast.FunctionDef|null,
                                 outputPrefix : string,
                                 importanceOffset : number) : InternalFormattedChunk[] {
        if (value === null || value === undefined)
            return [];

        if (isPlainObject(value)) {
            // if it's a plain object, recurse format fallback
            return this._formatFallbackObject(value, functionDef, key + '.', outputPrefix);
        } else if (Array.isArray(value)) {
            if (value.length === 0)
                return [];

            // if it's an array with only one element, pretend it's not array at all
            if (value.length === 1)
                return this._formatFallbackValue(key, value[0], functionDef, outputPrefix, importanceOffset);

            // if it's an array, iterate all of the elements
            const keyDisplay = this._displayKey(key, functionDef);
            const result : InternalFormattedChunk[] = [];

            const importance = importanceOffset + this._getArgImportance(key, functionDef);

            // add a 0.1 to make sure elements stay ordered correctly, +0.5 for the prefix
            result.push({
                formatted: outputPrefix + this._interp(this._("Here are the ${key}:"), {
                    key: keyDisplay
                }),
                isPrefix: true,
                importance: importance + 0.1
            });
            for (let i = 0; i < value.length; i++) {
                const element = value[i];
                // note: the recursive call will apply getArgImportance again, so we pass the offset,
                // not the argument importance
                const elementimportance = importanceOffset + (value.length - i) * 0.1/value.length;
                result.push(...this._formatFallbackValue(key, element, functionDef, outputPrefix + '\t', elementimportance));
            }
            return result;
        } else {
            // otherwise, it's a scalar value, and we just display it
            const keyDisplay = this._displayKey(key, functionDef);

            const arg = functionDef !== null ? functionDef.getArgument(key) : null;
            const importance = importanceOffset + this._getArgImportance(key, functionDef);

            if (key === 'id') {
                // id is special
                return [{
                    formatted: interpolate('${value}', {
                        value
                    }, {
                        locale: this._locale,
                        timezone: this._timezone,
                        nullReplacement: this._("N/A")
                    })||'',
                    isPrefix: false,
                    importance
                }];
            }
            if (arg) {
                // do a type-based display if we can
                if (arg.type instanceof Type.Entity && arg.type.type === 'tt:picture') {
                    return [{
                        formatted: new (FORMAT_TYPES.picture)({
                            type: 'picture',
                            url: value as string
                        }),
                        isPrefix: false,
                        importance
                    }];
                }
            }

            return [{
                formatted: outputPrefix + interpolate(this._("The ${key} is ${value}."), {
                    key: keyDisplay,
                    value
                }, {
                    locale: this._locale,
                    timezone: this._timezone,
                    nullReplacement: this._("N/A")
                }),
                isPrefix: false,
                importance
            }];
        }
    }

    private _formatFallbackObject(outputValue : PlainObject,
                                  functionDef : Ast.FunctionDef|null,
                                  keyPrefix = '',
                                  outputPrefix = '',
                                  importanceOffset = 0.0) : InternalFormattedChunk[] {
        let keyCount = 0, projectionKey = '', hasId = false;
        for (const key in outputValue) {
            if (key === 'id') {
                hasId = true;
            } else {
                projectionKey = key;
                keyCount ++;
            }
        }
        if (hasId && keyCount === 1) {
            // special case a projection of a single parameter:
            const keyDisplay = this._displayKey(projectionKey, functionDef);

            const importance = importanceOffset + this._getArgImportance(projectionKey, functionDef);

            return [{
                formatted: outputPrefix + interpolate(this._("The ${key} of ${name} is ${value}."), {
                    key: keyDisplay,
                    name: outputValue.id,
                    value: outputValue[projectionKey],
                }, {
                    locale: this._locale,
                    timezone: this._timezone,
                    nullReplacement: this._("N/A")
                }),
                isPrefix: false,
                importance
            }];
        }

        const result = [];
        for (const key in outputValue)
            result.push(...this._formatFallbackValue(keyPrefix + key, outputValue[key], functionDef, outputPrefix, importanceOffset));
        return result;
    }

    private async _formatFallback(outputValue : PlainObject,
                                  outputType : string|null) : Promise<FormattedChunk[]> {
        const functionDef = await this._getFunctionDef(outputType);

        // iterate the whole result to collect how to display, and each
        // message importance
        let output = this._formatFallbackObject(outputValue, functionDef);

        // sort from the most to the least important
        output.sort((a, b) => {
            return b.importance - a.importance;
        });

        // take the top 5, and cut anything that has negative importance
        output = output.slice(0, 5).filter((out) => out.importance >= 0);

        // if the last element is an array prefix, cut it
        if (output.length > 0 && output[output.length-1].isPrefix)
            output.pop();

        // return the actual format objects
        return output.map((out) => out.formatted);
    }

    private async _formatAggregation(outputValue : PlainObject,
                                     operator : string,
                                     outputType : string) : Promise<string[]> {
        if (operator === 'count' && Object.prototype.hasOwnProperty.call(outputValue, 'count')) {
            return [this._interp(this._("${count:plural:\
                one {I found ${count} result.}\
                other {I found ${count} results.}\
            }"), { count: outputValue.count })];
        }

        const key = Object.keys(outputValue)[0];
        const functionDef = await this._getFunctionDef(outputType);
        const keyDisplay = this._displayKey(key, functionDef);

        let phrase;
        switch (operator) {
        case 'count':
            phrase = this._("${value:plural:\
                one {I found only one value of ${key}.}\
                other {I found ${value} distinct values of ${key}.}\
            }");
            break;
        case 'min':
            phrase = this._("The minimum ${key} is ${value}.");
            break;
        case 'max':
            phrase = this._("The maximum ${key} is ${value}.");
            break;
        case 'avg':
            phrase = this._("The average ${key} is ${value}.");
            break;
        case 'sum':
            phrase = this._("The total ${key} is ${value}.");
            break;
        default:
            throw new TypeError(`Unexpected aggregation operator ${operator}`);
        }

        return [this._interp(phrase, {
            key: keyDisplay,
            value: outputValue[key]
        })];
    }

    formatForType(outputType : string,
                  outputValue : PlainObject,
                  hint : 'string') : Promise<string>;
    formatForType(outputType : string,
                  outputValue : PlainObject,
                  hint : 'messages') : Promise<FormattedChunk[]>;
    formatForType(outputType : string,
                  outputValue : PlainObject,
                  hint : string) : Promise<string|FormattedChunk[]>;
    async formatForType(outputType : string,
                        outputValue : PlainObject,
                        hint : string) : Promise<string|FormattedChunk[]> {
        // apply masquerading for @remote.receive
        // outputValue[0..2] are the input parameters (principal, programId and flow)
        // outputValue[3] is the real underlying output type, and outputValue.slice(4)
        // is the real data
        if (outputType === 'org.thingpedia.builtin.thingengine.remote:receive')
            outputType = String(outputValue.__kindChannel);

        if (outputType === null)
            return this._formatFallback(outputValue, null);

        // for now, ignore multiple output types
        if (outputType.indexOf('+') >= 0) {
            const types = outputType.split('+');
            outputType = types[types.length-1];
        }

        const aggregation = /^([a-zA-Z]+)\(([^)]+)\)$/.exec(outputType);
        if (aggregation !== null)
            return this._formatAggregation(outputValue, aggregation[1], aggregation[2]);

        const [kind, function_name] = outputType.split(':');
        const metadata = (await this._schemas.getFormatMetadata(kind, function_name)) as FormatSpecChunk[];
        if (metadata.length) {
            const formatted = this.format(metadata, outputValue, hint);
            // if formatting returned nothing (due to killing all elements from the format spec)
            // this is likely a projection, so we use the fallback to format something
            if (!formatted || formatted.length === 0)
                return this._applyHint(await this._formatFallback(outputValue, outputType), hint);
            return formatted;
        } else {
            return this._applyHint(await this._formatFallback(outputValue, outputType), hint);
        }
    }

    format(formatspec : FormatSpecChunk[],
           argMap : PlainObject,
           hint : 'string') : string;
    format(formatspec : FormatSpecChunk[],
           argMap : PlainObject,
           hint : 'messages') : FormattedChunk[];
    format(formatspec : FormatSpecChunk[],
           argMap : PlainObject,
           hint : string) : string|FormattedChunk[];
    format(formatspec : FormatSpecChunk[],
           argMap : PlainObject,
           hint : string) : string|FormattedChunk[] {

        const formatted : Array<Array<FormattedChunk|null>|FormattedChunk|null> = formatspec.map((f : FormatSpecChunk, i : number) : Array<FormattedChunk|null>|FormattedChunk|null => {
            if (typeof f === 'string')
                return this._replaceInString(f, argMap);
            if (f === null)
                return null;
            if (typeof f !== 'object')
                return String(f);
            if (f.type === 'text')
                return this._replaceInString(f.text, argMap);

            const formatType = FORMAT_TYPES[f.type as keyof typeof FORMAT_TYPES] as FormattedObjectClass;
            if (!formatType) {
                console.log(`WARNING: unrecognized format type ${f.type}`);
                return null;
            }
            const obj = new formatType(f);
            obj.replaceParameters(this, argMap);

            if (!obj.isValid())
                return null;

            return obj;
        });
        return this._applyHint(formatted, hint);
    }

    private _normalize(formatted : Array<Array<FormattedChunk|null>|FormattedChunk|null>) : FormattedChunk[] {
        // filter out null/undefined in the array
        const filtered = formatted.filter((formatted) => !isNull(formatted)) as Array<FormattedChunk[]|FormattedChunk>;
        // flatten formatted (returning array in function causes nested array)
        const empty : FormattedChunk[] = [];
        return empty.concat(...filtered);
    }

    private _applyHint(formatted : Array<Array<FormattedChunk|null>|FormattedChunk|null>, hint : 'string') : string;
    private _applyHint(formatted : Array<Array<FormattedChunk|null>|FormattedChunk|null>, hint : 'messages') : FormattedChunk[];
    private _applyHint(formatted : Array<Array<FormattedChunk|null>|FormattedChunk|null>, hint : string) : string|FormattedChunk[];
    private _applyHint(formatted : Array<Array<FormattedChunk|null>|FormattedChunk|null>, hint : string) : string|FormattedChunk[] {
        const normalized = this._normalize(formatted);

        if (hint === 'string') {
            return normalized.map((x) => {
                if (typeof x !== 'object')
                    return this.anyToString(x);
                return x.toLocaleString(this._locale);
            }).join('\n');
        } else {
            return normalized;
        }
    }

    anyToString(o : unknown) : string {
        if (Array.isArray(o))
            return (o.map(this.anyToString, this).join(', '));
        else if (Builtin.Location.isLocation(o))
            return this.locationToString(o);
        else if (typeof o === 'number')
            return (Math.floor(o) === o ? o.toFixed(0) : o.toFixed(3));
        else if (o instanceof Date)
            return this.dateAndTimeToString(o);
        else
            return String(o);
    }

    /**
     * Convert a location to a string.
     *
     * @param {Builtin.Location} loc - the location to display
     * @return {string} the formatted location
     * @deprecated Use {@link Builtin.Location#toLocaleString} instead.
     */
    locationToString(loc : Builtin.LocationLike) : string {
        return new Builtin.Location(loc.y, loc.x, loc.display).toLocaleString(this._locale);
    }
}
