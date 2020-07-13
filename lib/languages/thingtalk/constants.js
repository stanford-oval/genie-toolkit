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

const { Constant } = require('../../sentence-generator/runtime');

const MAX_CONSTANTS = 20;
const MAX_SMALL_INTEGER = 12;

function extractConstants(ast) {
    const constants = {};
    function addConstant(token, display, value) {
        if (constants[token])
            constants[token].push({ display, value });
        else
            constants[token] = [{ display, value }];
    }

    ast.visit(new class extends Ast.NodeVisitor {
        visitStringValue(value) {
            addConstant('QUOTED_STRING', value.value, value);
        }

        visitEntityValue(value) {
            switch (value.type) {
            case 'tt:url':
                addConstant('URL', value.value, value);
                break;

            case 'tt:username':
                addConstant('USERNAME', value.value, value);
                break;

            case 'tt:hashtag':
                addConstant('HASHTAG', value.value, value);
                break;

            case 'tt:phone_number':
                addConstant('PHONE_NUMBER', value.value, value);
                break;

            case 'tt:email_address':
                addConstant('EMAIL_ADDRESS', value.value, value);
                break;

            case 'tt:path_name':
                addConstant('PATH_NAME', value.value, value);
                break;

            default:
                addConstant('GENERIC_ENTITY_' + value.type, value.display || value.value, value);
                break;
            }
        }

        visitNumberValue(value) {
            addConstant('NUMBER', String(value.value), value);
        }

        visitCurrencyValue(value) {
            addConstant('CURRENCY', String(value.value) + ' ' + value.unit, value);
        }

        visitLocationValue(value) {
            if (value.value instanceof Ast.Location.Absolute && value.value.display)
                addConstant('LOCATION', value.value.display, value);
            else if (value.value instanceof Ast.Location.Unresolved && value.value.name)
                addConstant('LOCATION', value.value.name, value);
        }

        visitTimeValue(value) {
            if (!(value.value instanceof Ast.Time.Absolute))
                return;
            const time = value.value;
            addConstant('TIME', `${time.hour}:${time.minute < 10 ? '0' : ''}${time.minute}:${time.second < 10 ? '0' : ''}${time.second}`, value);
        }

        visitDateValue(value) {
            if (!(value.value instanceof Date))
                return;
            addConstant('DATE', value.date.toISOString(), value);
        }
    });

    return constants;
}

function createConstantsForDialogue(token, type, maxConstants) {
    // ignore maxConstants, because it's too low (5) and there is no way to set it differently

    const constants = [];
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
        case 'DURATION':
            constants.push({
                display: 'DURATION_' + i,
                value: new Ast.Value.Measure(2 + i, 'ms')
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
        default: {
            assert(token.startsWith('GENERIC_ENTITY_'));
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

function createConstantsForBasic(token, type, maxConstants) {
    const escapedToken = token.replace(/[:._]/g, (match) => {
        if (match === '_')
            return '__';
        let code = match.charCodeAt(0);
        return code < 16 ? '_0' + code.toString(16) : '_' + code.toString(16);
    });
    const constants = [];
    for (let i = 0; i < maxConstants; i++) {
        const value = new Ast.Value.VarRef(`__const_${escapedToken}_${i}`, type);
        value.constNumber = i;
        constants.push(new Constant(token, i, value));
    }
    return constants;
}

module.exports = {
    extractConstants,
    createConstantsForDialogue,
    createConstantsForBasic
};
