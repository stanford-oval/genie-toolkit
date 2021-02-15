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

import { Ast, Type, Syntax } from 'thingtalk';

const MAX_CONSTANTS = 15;
const MAX_SMALL_INTEGER = 12;

interface Constant {
    token : string;
    value : Ast.Value;
}
type ConstantMap = { [key : string] : Constant[] };

function extractConstants(ast : Ast.Node, entityAllocator : Syntax.SequentialEntityAllocator) : ConstantMap {
    const constants : ConstantMap = {};
    function addConstant(tokenPrefix : string, value : Ast.Value) : void {
        const token = entityAllocator.findEntity(tokenPrefix, value.toEntity()).flatten().join(' ');

        if (constants[tokenPrefix])
            constants[tokenPrefix].push({ token, value });
        else
            constants[tokenPrefix] = [{ token, value }];
    }

    ast.visit(new class extends Ast.NodeVisitor {
        visitStringValue(value : Ast.StringValue) : boolean {
            addConstant('QUOTED_STRING', value);
            return true;
        }

        visitEntityValue(value : Ast.EntityValue) : boolean {
            switch (value.type) {
            case 'tt:url':
                addConstant('URL', value);
                break;

            case 'tt:username':
                addConstant('USERNAME', value);
                break;

            case 'tt:hashtag':
                addConstant('HASHTAG', value);
                break;

            case 'tt:phone_number':
                addConstant('PHONE_NUMBER', value);
                break;

            case 'tt:email_address':
                addConstant('EMAIL_ADDRESS', value);
                break;

            case 'tt:path_name':
                addConstant('PATH_NAME', value);
                break;

            case 'tt:picture':
                addConstant('PICTURE', value);
                break;

            default:
                addConstant('GENERIC_ENTITY_' + value.type, value);
                break;
            }
            return true;
        }

        visitMeasureValue(value : Ast.MeasureValue) : boolean {
            const normalizedUnit = new Type.Measure(value.unit).unit;
            addConstant('MEASURE_' + normalizedUnit, value);
            return true;
        }

        visitNumberValue(value : Ast.NumberValue) : boolean {
            addConstant('NUMBER', value);
            return true;
        }

        visitCurrencyValue(value : Ast.CurrencyValue) : boolean {
            addConstant('CURRENCY', value);
            return true;
        }

        visitLocationValue(value : Ast.LocationValue) : boolean {
            const loc = value.value;
            if (loc instanceof Ast.AbsoluteLocation || loc instanceof Ast.UnresolvedLocation)
                addConstant('LOCATION', value);
            return true;
        }

        visitTimeValue(value : Ast.TimeValue) : boolean {
            const time = value.value;
            if (!(time instanceof Ast.AbsoluteTime))
                return true;
            addConstant('TIME', value);
            return true;
        }

        visitDateValue(value : Ast.DateValue) : boolean {
            const date = value.value;
            if (!(date instanceof Date))
                return true;
            addConstant('DATE', value);
            return true;
        }
    });

    return constants;
}

function createConstants(tokenPrefix : string,
                         type : Type,
                         maxConstants : number,
                         entityAllocator : Syntax.SequentialEntityAllocator) : Constant[] {
    // ignore maxConstants, because it's too low (5) and there is no way to set it differently

    const constants : Constant[] = [];

    function createConstant(type : string, index : number, value : Ast.Value) {
        const token = type + '_' + index;
        constants.push({ token, value });
        entityAllocator.entities[token] = value.toEntity();
        entityAllocator.offsets[type] = Math.max(entityAllocator.offsets[type] || 0, index+1);
    }

    for (let i = 0; i < MAX_CONSTANTS; i++) {
        switch (tokenPrefix) {
        case 'NUMBER':
            createConstant('NUMBER', i, new Ast.Value.Number(MAX_SMALL_INTEGER + 1 + i));
            break;
        case 'QUOTED_STRING':
            createConstant('QUOTED_STRING', i, new Ast.Value.String('str:QUOTED_STRING::' + i + ':'));
            break;
        case 'URL':
            createConstant('URL', i, new Ast.Value.Entity('str:URL::' + i + ':', 'tt:url'));
            break;
        case 'USERNAME':
            createConstant('USERNAME', i, new Ast.Value.Entity('str:USERNAME::' + i + ':', 'tt:username'));
            break;
        case 'HASHTAG':
            createConstant('HASHTAG', i, new Ast.Value.Entity('str:HASHTAG::' + i + ':', 'tt:hashtag'));
            break;
        case 'PHONE_NUMBER':
            createConstant('PHONE_NUMBER', i, new Ast.Value.Entity('str:PHONE_NUMBER::' + i + ':', 'tt:phone_number'));
            break;
        case 'EMAIL_ADDRESS':
            createConstant('EMAIL_ADDRESS', i, new Ast.Value.Entity('str:EMAIL_ADDRESS::' + i + ':', 'tt:email_address'));
            break;
        case 'PATH_NAME':
            createConstant('PATH_NAME', i, new Ast.Value.Entity('str:PATH_NAME::' + i + ':', 'tt:path_name'));
            break;
        case 'CURRENCY':
            createConstant('CURRENCY', i, new Ast.Value.Currency(2 + i, 'usd'));
            break;
        case 'LOCATION':
            createConstant('LOCATION', i, new Ast.Value.Location(new Ast.Location.Absolute(2 + i, 2 + i, null)));
            break;
        case 'DATE':
            createConstant('DATE', i, new Ast.Value.Date(new Date(2018, 0, 2 + i)));
            break;
        case 'TIME':
            createConstant('TIME', i, new Ast.Value.Time(new Ast.Time.Absolute(Math.floor(i/4), [0, 15, 30, 45][i % 4], 0)));
            break;
        case 'RECURRENT_TIME_SPECIFICATION':
            // FIXME do nothing
            break;
        default: {
            // ignore MEASURE_* tokens, they are only used in inference mode, and for those
            // we'll extract the constants from the context
            if (tokenPrefix.startsWith('MEASURE_'))
                break;

            assert(tokenPrefix.startsWith('GENERIC_ENTITY_'));
            assert(type instanceof Type.Entity);
            const string = `str:ENTITY_${type.type}::${i}:`;
            createConstant(tokenPrefix, i, new Ast.Value.Entity(string, type.type, string));
        }
        }
    }
    return constants;
}

export {
    extractConstants,
    createConstants,
};
