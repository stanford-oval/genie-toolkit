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
import { Syntax } from 'thingtalk';

export type AnyEntity = Syntax.AnyEntity;
export type EntityMap = Syntax.EntityMap;
export type MeasureEntity = Syntax.MeasureEntity;
export type TimeEntity = Syntax.TimeEntity;
export type GenericEntity = Syntax.GenericEntity;
export type LocationEntity = Syntax.LocationEntity;

const MAX_SMALL_INTEGER = 12;

const ENTITIES : { [key : string] : (idx : number) => AnyEntity } = {
    DURATION: (idx) => ({ value: idx + 2, unit: 'ms' }),
    NUMBER: (idx) => idx + MAX_SMALL_INTEGER + 1,
    DATE: (idx) => ({ day: idx + 2, month: 1, year: 2018 }),
    TIME: (idx) => ({ hour: Math.floor(idx/4), minute: [0, 15, 30, 45][idx % 4], second: 0 }),
    CURRENCY: (idx) => ({ value: idx + 2, unit: 'usd' }),
    LOCATION: (idx) => ({ latitude: idx + 2, longitude: idx + 2 }),
    QUOTED_STRING: (idx) => namedString('QUOTED_STRING', idx),
    PATH_NAME: (idx) => namedString('PATH_NAME', idx),
    URL: (idx) => namedString('URL', idx),
    PHONE_NUMBER: (idx) => namedString('PHONE_NUMBER', idx),
    EMAIL_ADDRESS: (idx) => namedString('EMAIL_ADDRESS', idx),
    USERNAME: (idx) => namedString('USERNAME', idx),
    HASHTAG: (idx) => namedString('HASHTAG', idx),
    PICTURE: (idx) => namedString('PICTURE', idx)
};
Object.freeze(ENTITIES);

function namedString(key : string, idx : number) : string {
    return `str:${key}::${idx}:`;
}

function makeDummyMeasure(entity : string) : Syntax.MeasureEntity {
    const match = /^MEASURE_([A-Za-z]+)_([0-9]+)$/.exec(entity);
    assert(match);
    return { unit: match[1], value: 2.0 + parseInt(match[2]) };
}

function parseDate(form : Date|Syntax.DateEntity) : Date {
    if (form instanceof Date)
        return form;

    const now = new Date;
    let year = form.year;
    if (year === undefined || year < 0)
        year = now.getFullYear();
    let month = form.month;
    if (month === undefined || month < 0)
        month = now.getMonth() + 1;
    let day = form.day;
    if (day === undefined || day < 0)
        day = now.getDate();
    let hour = form.hour;
    if (hour === undefined || hour < 0)
        hour = 0;
    let minute = form.minute;
    if (minute === undefined || minute < 0)
        minute = 0;
    let second = form.second;
    if (second === undefined || second < 0)
        second = 0;
    const millisecond = (second - Math.floor(second))*1000;
    second = Math.floor(second);

    return new Date(year, month-1, day, hour, minute, second, millisecond);
}

function entitiesEqual(type : string, one : AnyEntity, two : AnyEntity) : boolean {
    if (one === two)
        return true;
    if (!one || !two)
        return false;
    if (type.startsWith('GENERIC_ENTITY_')) {
        const eone = one as Syntax.GenericEntity;
        const etwo = two as Syntax.GenericEntity;

        if (!eone.value && !etwo.value)
            return eone.display === etwo.display;
        return (eone.value === etwo.value);
    }

    if (type.startsWith('MEASURE_') ||
        type === 'DURATION') {
        const eone = one as Syntax.MeasureEntity;
        const etwo = two as Syntax.MeasureEntity;
        return eone.value === etwo.value && eone.unit === etwo.unit;
    }

    switch (type) {
    case 'CURRENCY': {
        const eone = one as Syntax.MeasureEntity;
        const etwo = two as Syntax.MeasureEntity;
        return eone.value === etwo.value && eone.unit === etwo.unit;
    }
    case 'TIME': {
        const eone = one as Syntax.TimeEntity;
        const etwo = two as Syntax.TimeEntity;
        return eone.hour === etwo.hour &&
            eone.minute === etwo.minute &&
            (eone.second || 0) === (etwo.second || 0);
    }
    case 'DATE':
        if (!(one instanceof Date))
            one = parseDate(one as Syntax.DateEntity);
        if (!(two instanceof Date))
            two = parseDate(two as Syntax.DateEntity);

        return +one === +two;
    case 'LOCATION': {
        const eone = one as Syntax.LocationEntity;
        const etwo = two as Syntax.LocationEntity;
        if (isNaN(eone.latitude) && isNaN(etwo.latitude) && isNaN(eone.longitude) && isNaN(etwo.longitude))
            return eone.display === etwo.display;
        return Math.abs(eone.latitude - etwo.latitude) < 0.01 &&
            Math.abs(eone.longitude - etwo.longitude) < 0.01;
    }
    }

    return false;
}

const ENTITY_MATCH_REGEX = /^([A-Z].*)_([0-9]+)$/;

function makeDummyEntity(token : string) : AnyEntity {
    const match = ENTITY_MATCH_REGEX.exec(token);
    if (match === null)
        throw new TypeError(`invalid entity ${token}`);
    const [,entityType,entityIndex] = match;
    assert(!Number.isNaN(Number(entityIndex)), token);

    if (entityType.startsWith('MEASURE_'))
        return makeDummyMeasure(token);
    else if (entityType.startsWith('GENERIC_ENTITY_'))
        return { value: namedString(entityType.substring('GENERIC_'.length), Number(entityIndex)), display: null };
    else if (!(entityType in ENTITIES))
        throw new Error(`missing entity ${token}`);
    else
        return ENTITIES[entityType](Number(entityIndex));
}

function makeDummyEntities(preprocessed : string) : EntityMap {
    const entities : EntityMap = {};
    for (const token of preprocessed.split(' ')) {
        if (ENTITY_MATCH_REGEX.test(token))
            entities[token] = makeDummyEntity(token);
    }
    return entities;
}

interface TokenizerResult {
    entities : EntityMap;
    tokens : string[];
}

function renumberEntities(tokenized : TokenizerResult, context : EntityMap) : void {
    const { entities, tokens } = tokenized;
    const out : EntityMap = {};

    const offsets : { [key : string] : number } = {};
    for (const key in context) {
        const [, type, num] = /^(.+)_([0-9]+)$/.exec(key)!;

        const next = offsets[type] || 0;
        offsets[type] = Math.max(next, parseInt(num, 10) + 1);
        out[key] = context[key];
    }

    const rewrites : { [key : string] : string } = {};

    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] in rewrites) {
            tokens[i] = rewrites[tokens[i]];
            continue;
        }

        if (tokens[i] in entities) {
            const key = tokens[i];
            const [, type, ] = /^(.+)_([0-9]+)$/.exec(key)!;
            const value = entities[key];

            let found = false;
            for (const what in context) {
                if (!what.startsWith(type + '_'))
                    continue;

                if (entitiesEqual(type, context[what], value)) {
                    found = true;
                    rewrites[key] = what;
                    tokens[i] = what;
                    break;
                }
            }

            if (!found) {
                const next = offsets[type] || 0;
                offsets[type] = next + 1;
                const newkey = type + '_' + next;
                out[newkey] = entities[key];
                rewrites[key] = newkey;
                tokens[i] = newkey;
            }
        }
    }

    tokenized.entities = out;
}

export {
    makeDummyEntity,
    makeDummyEntities,
    renumberEntities,
};
