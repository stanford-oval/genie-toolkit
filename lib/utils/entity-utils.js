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

const MAX_SMALL_INTEGER = 12;

const ENTITIES = {
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
    PICTURE: (idx) => namedString('PICTURE', idx),
    RECURRENT_TIME_SPECIFICATION: (idx) => namedString('RECURRENT_TIME_SPECIFICATION', idx)
};
Object.freeze(ENTITIES);

function namedString(key, idx) {
    return `str:${key}::${idx}:`;
}

function makeDummyMeasure(entity) {
    const match = /^MEASURE_([A-Za-z]+)_([0-9]+)$/.exec(entity);
    return { unit: match[1], value: 2.0 + parseInt(match[2]) };
}

function parseDate(form) {
    if (form instanceof Date)
        return form;

    let now = new Date;
    let year = form.year;
    if (year < 0 || year === undefined)
        year = now.getFullYear();
    let month = form.month;
    if (month < 0 || month === undefined)
        month = now.getMonth() + 1;
    let day = form.day;
    if (day < 0 || day === undefined)
        day = now.getDate();
    let hour = form.hour;
    if (hour < 0 || hour === undefined)
        hour = 0;
    let minute = form.minute;
    if (minute < 0 || minute === undefined)
        minute = 0;
    let second = form.second;
    if (second < 0 || second === undefined)
        second = 0;
    let millisecond = (second - Math.floor(second))*1000;
    second = Math.floor(second);

    return new Date(year, month-1, day, hour, minute, second, millisecond);
}

function entitiesEqual(type, one, two) {
    if (one === two)
        return true;
    if (!one || !two)
        return false;
    if (type.startsWith('GENERIC_ENTITY_'))
        return (one.value === two.value);

    if (type.startsWith('MEASURE_') ||
        type === 'DURATION')
        return one.value === two.value && one.unit === two.unit;

    switch (type) {
    case 'CURRENCY':
        return one.value === two.value && one.unit === two.unit;
    case 'TIME':
        return one.hour === two.hour &&
            one.minute === two.minute &&
            (one.second || 0) === (two.second || 0);
    case 'DATE':
        if (!(one instanceof Date))
            one = parseDate(one);
        if (!(two instanceof Date))
            two = parseDate(two);

        return +one === +two;
    case 'LOCATION':
        return Math.abs(one.latitude - two.latitude) < 0.01 &&
            Math.abs(one.longitude - two.longitude) < 0.01;
    }

    return false;
}

const ENTITY_MATCH_REGEX = /^([A-Z].*)_([0-9]+)$/;

function makeDummyEntity(token) {
    const match = ENTITY_MATCH_REGEX.exec(token);
    if (match === null)
        throw new TypeError(`invalid entity ${token}`);
    const [,entityType,entityIndex] = match;
    assert(!Number.isNaN(Number(entityIndex)), token);

    if (entityType.startsWith('MEASURE_'))
        return makeDummyMeasure(token);
    else if (entityType.startsWith('GENERIC_ENTITY_'))
        return { value: namedString(entityType.substring('GENERIC_'.length), entityIndex), display: null };
    else if (!(entityType in ENTITIES))
        throw new Error(`missing entity ${token}`);
    else
        return ENTITIES[entityType](Number(entityIndex));
}

function makeDummyEntities(preprocessed) {
    const entities = {};
    for (let token of preprocessed.split(' ')) {
        if (/^[A-Z]/.test(token))
            entities[token] = makeDummyEntity(token);
    }
    return entities;
}

function renumberEntities(tokenized, context) {
    const { entities, tokens } = tokenized;
    const out = {};

    const offsets = {};
    for (let key in context) {
        const [, type, num] = /^(.+)_([0-9]+)$/.exec(key);

        let next = offsets[type] || 0;
        offsets[type] = Math.max(next, parseInt(num, 10) + 1);
        out[key] = context[key];
    }

    const rewrites = {};

    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] in rewrites) {
            tokens[i] = rewrites[tokens[i]];
            continue;
        }

        if (tokens[i] in entities) {
            const key = tokens[i];
            const [, type, ] = /^(.+)_([0-9]+)$/.exec(key);
            const value = entities[key];

            let found = false;
            for (let what in context) {
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
                let next = offsets[type] || 0;
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

module.exports = {
    makeDummyEntity,
    makeDummyEntities,
    renumberEntities,
};
