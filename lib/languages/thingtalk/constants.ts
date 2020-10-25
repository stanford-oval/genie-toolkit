// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import assert from 'assert';

import { Ast, Type } from 'thingtalk';

const MAX_CONSTANTS = 15;
const MAX_SMALL_INTEGER = 12;

function numberToString(num : number) : string {
    if (Math.floor(num) === num)
        return String(num);
    else
        return num.toFixed(1);
}

interface Constant {
    display : string;
    value : Ast.Value;
}
type ConstantMap = { [key : string] : Constant[] };

function extractConstants(ast : Ast.Node) : ConstantMap {
    const constants : ConstantMap = {};
    function addConstant(token : string, display : string, value : Ast.Value) : void {
        if (constants[token])
            constants[token].push({ display, value });
        else
            constants[token] = [{ display, value }];
    }

    ast.visit(new class extends Ast.NodeVisitor {
        visitStringValue(value : Ast.StringValue) : boolean {
            addConstant('QUOTED_STRING', value.value.replace(/[ \t\v\r\n]+/g, ' ').trim(), value);
            return true;
        }

        visitEntityValue(value : Ast.EntityValue) : boolean {
            switch (value.type) {
            case 'tt:url':
                addConstant('URL', value.value || '', value);
                break;

            case 'tt:username':
                addConstant('USERNAME', value.value || '', value);
                break;

            case 'tt:hashtag':
                addConstant('HASHTAG', value.value || '', value);
                break;

            case 'tt:phone_number':
                addConstant('PHONE_NUMBER', value.value || '', value);
                break;

            case 'tt:email_address':
                addConstant('EMAIL_ADDRESS', value.value || '', value);
                break;

            case 'tt:path_name':
                addConstant('PATH_NAME', value.value || '', value);
                break;

            default:
                addConstant('GENERIC_ENTITY_' + value.type, value.display || value.value || '', value);
                break;
            }
            return true;
        }

        visitMeasureValue(value : Ast.MeasureValue) : boolean {
            const normalizedUnit = new Type.Measure(value.unit).unit;
            // TODO:
            // - use the user's preferred measurement unit and/or the most appropriate unit for the
            //   specific value rather than what's in the result object
            //   (which likely will be the base unit)
            // - use value.toLocaleString() with unit formatting
            //   it depends on https://github.com/tc39/proposal-unified-intl-numberformat
            //   which is part of ES2020 (so node 14 or later?)
            addConstant('MEASURE_' + normalizedUnit, numberToString(value.value) + ' ' + value.unit, value);
            return true;
        }

        visitNumberValue(value : Ast.NumberValue) : boolean {
            addConstant('NUMBER', numberToString(value.value), value);
            return true;
        }

        visitCurrencyValue(value : Ast.CurrencyValue) : boolean {
            addConstant('CURRENCY', value.code + ' ' + (value.value.toFixed(2)), value);
            return true;
        }

        visitLocationValue(value : Ast.LocationValue) : boolean {
            const loc = value.value;
            if (loc instanceof Ast.AbsoluteLocation && loc.display)
                addConstant('LOCATION', loc.display, value);
            else if (loc instanceof Ast.UnresolvedLocation && loc.name)
                addConstant('LOCATION', loc.name, value);
            return true;
        }

        visitTimeValue(value : Ast.TimeValue) : boolean {
            const time = value.value;
            if (!(time instanceof Ast.AbsoluteTime))
                return true;
            addConstant('TIME', `${time.hour}:${time.minute < 10 ? '0' : ''}${time.minute}:${time.second < 10 ? '0' : ''}${time.second}`, value);
            return true;
        }

        visitDateValue(value : Ast.DateValue) : boolean {
            const date = value.value;
            if (!(date instanceof Date))
                return true;

            // FIXME we should pass the right locale here, and also use ThingTalk.FormatUtils
            // which has better defaults
            // the "correct" way is to generate a DATE_* token here, and put the date in the right
            // way in postprocessNLG (which is locale specific)

            // check for midnight local, and midnight UTC, to mean date without time
            if ((date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) ||
                (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0))
                addConstant('DATE', date.toLocaleDateString(), value);
            else
                addConstant('DATE', date.toLocaleString(), value);
            return true;
        }
    });

    return constants;
}

function createConstants(token : string, type : Type, maxConstants : number) : Constant[] {
    // ignore maxConstants, because it's too low (5) and there is no way to set it differently

    const constants : Constant[] = [];
    for (let i = 0; i < MAX_CONSTANTS; i++) {
        switch (token) {
        case 'NUMBER':
            constants.push({
                display: 'NUMBER_' + i,
                value: new Ast.Value.Number(MAX_SMALL_INTEGER + 1 + i)
            });
            break;
        case 'QUOTED_STRING':
            constants.push({
                display: 'QUOTED_STRING_' + i,
                value: new Ast.Value.String('str:QUOTED_STRING::' + i + ':')
            });
            break;
        case 'URL':
            constants.push({
                display: 'URL_' + i,
                value: new Ast.Value.Entity('str:URL::' + i + ':', 'tt:url')
            });
            break;
        case 'USERNAME':
            constants.push({
                display: 'USERNAME_' + i,
                value: new Ast.Value.Entity('str:USERNAME::' + i + ':', 'tt:username')
            });
            break;
        case 'HASHTAG':
            constants.push({
                display: 'HASHTAG_' + i,
                value: new Ast.Value.Entity('str:HASHTAG::' + i + ':', 'tt:hashtag')
            });
            break;
        case 'PHONE_NUMBER':
            constants.push({
                display: 'PHONE_NUMBER_' + i,
                value: new Ast.Value.Entity('str:PHONE_NUMBER::' + i + ':', 'tt:phone_number')
            });
            break;
        case 'EMAIL_ADDRESS':
            constants.push({
                display: 'EMAIL_ADDRESS_' + i,
                value: new Ast.Value.Entity('str:EMAIL_ADDRESS::' + i + ':', 'tt:email_address')
            });
            break;
        case 'PATH_NAME':
            constants.push({
                display: 'PATH_NAME_' + i,
                value: new Ast.Value.Entity('str:PATH_NAME::' + i + ':', 'tt:path_name')
            });
            break;
        case 'CURRENCY':
            constants.push({
                display: 'CURRENCY_' + i,
                value: new Ast.Value.Currency(2 + i, 'usd')
            });
            break;
        case 'LOCATION':
            constants.push({
                display: 'LOCATION_' + i,
                value: new Ast.Value.Location(new Ast.Location.Absolute(2 + i, 2 + i, null))
            });
            break;
        case 'DATE':
            constants.push({
                display: 'DATE_' + i,
                value: new Ast.Value.Date(new Date(2018, 0, 2 + i))
            });
            break;
        case 'TIME':
            constants.push({
                display: 'TIME_' + i,
                value: new Ast.Value.Time(new Ast.Time.Absolute(Math.floor(i/4), [0, 15, 30, 45][i % 4], 0))
            });
            break;
        case 'RECURRENT_TIME_SPECIFICATION':
            constants.push({
                display: 'RECURRENT_TIME_SPECIFICATION' + i,
                value: undefined as unknown as Ast.Value // FIXME
            });
            break;
        default: {
            // ignore MEASURE_* tokens, they are only used in inference mode, and for those
            // we'll extract the constants from the context
            if (token.startsWith('MEASURE_'))
                break;

            assert(token.startsWith('GENERIC_ENTITY_'));
            assert(type instanceof Type.Entity);
            const string = `str:ENTITY_${type.type}::${i}:`;
            constants.push({
                display: token + '_' + i,
                value: new Ast.Value.Entity(string, type.type, string)
            });
        }
        }
    }
    return constants;
}

export {
    extractConstants,
    createConstants,
};
