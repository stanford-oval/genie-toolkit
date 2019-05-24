// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2015-2019 The Board of Trustees of the Leland Stanford Junior University
//           2019 National Taiwan University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//         Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>
//
// See COPYING for details
"use strict";

function clean(name) {
    if (/^[vwgp]_/.test(name))
        name = name.substr(2);
    return name.replace(/_/g, ' ').replace(/([^A-Z ])([A-Z])/g, '$1 $2').toLowerCase();
}

const PARAM_REGEX = /\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})/;

function* split(pattern, regexp) {
    // a split that preserves capturing parenthesis

    let clone = new RegExp(regexp, 'g');
    let match = clone.exec(pattern);

    let i = 0;
    while (match !== null) {
        if (match.index > i)
            yield pattern.substring(i, match.index);
        yield match;
        i = clone.lastIndex;
        match = clone.exec(pattern);
    }
    if (i < pattern.length)
        yield pattern.substring(i, pattern.length);
}

const ENTITIES = {
    DURATION_0: { value: 2, unit: 'ms' },
    DURATION_1: { value: 3, unit: 'ms' },
    DURATION_3: { value: 4, unit: 'ms' },
    NUMBER_0: 2,
    NUMBER_1: 3,
    NUMBER_2: 4,
    NUMBER_3: 5,
    DATE_0: { day: 1, month: 1, year: 2018 },
    DATE_1: { day: 2, month: 1, year: 2018 },
    DATE_2: { day: 3, month: 1, year: 2018 },
    DATE_3: { day: 4, month: 1, year: 2018 },
    TIME_0: { hour: 0, minute: 1, second: 0 },
    TIME_1: { hour: 0, minute: 2, second: 0  },
    TIME_2: { hour: 0, minute: 3, second: 0  },
    TIME_3: { hour: 0, minute: 4, second: 0  },
    CURRENCY_0: { value: 2, unit: 'usd' },
    CURRENCY_1: { value: 3, unit: 'usd' },
    CURRENCY_2: { value: 4, unit: 'usd' },
    CURRENCY_3: { value: 5, unit: 'usd' },
    LOCATION_0: { latitude: 2, longitude: 2 },
    LOCATION_1: { latitude: 3, longitude: 3 },
    LOCATION_2: { latitude: 4, longitude: 4 },
    LOCATION_3: { latitude: 5, longitude: 5 },
    QUOTED_STRING_0: '"0"',
    QUOTED_STRING_1: '"1"',
    QUOTED_STRING_2: '"2"',
    QUOTED_STRING_3: '"3"',
    PATH_NAME_0: 'foo/0.png',
    PATH_NAME_1: 'foo/1.png',
    PATH_NAME_2: 'foo/2.png',
    PATH_NAME_3: 'foo/3.png',
    URL_0: 'https://0.com',
    URL_1: 'https://1.com',
    URL_2: 'https://2.com',
    URL_3: 'https://3.com',
    PHONE_NUMBER_0: '+11',
    PHONE_NUMBER_1: '+12',
    PHONE_NUMBER_2: '+13',
    PHONE_NUMBER_3: '+14',
    EMAIL_ADDRESS_0: '1@foo',
    EMAIL_ADDRESS_1: '2@foo',
    EMAIL_ADDRESS_2: '3@foo',
    EMAIL_ADDRESS_3: '4@foo',
    USERNAME_0: '@1',
    USERNAME_1: '@2',
    USERNAME_2: '@3',
    USERNAME_3: '@4',
    HASHTAG_0: '#0',
    HASHTAG_1: '#1',
    HASHTAG_2: '#2',
    HASHTAG_3: '#3',
};
Object.freeze(ENTITIES);

function makeDummyMeasure(entity) {
    const match = /^MEASURE_([A-Za-z]+)_([0-9]+)$/.exec(entity);
    return { unit: match[1], value: 1.0 + parseInt(match[2]) };
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

function splitParams(utterance) {
    return Array.from(split(utterance, PARAM_REGEX));
}

async function tokenizeExample(tokenizer, utterance, id, language) {
    let replaced = '';
    let params = [];

    for (let chunk of splitParams(utterance.trim())) {
        if (chunk === '')
            continue;
        if (typeof chunk === 'string') {
            replaced += chunk;
            continue;
        }

        let [match, param1, param2, opt] = chunk;
        if (match === '$$') {
            replaced += '$';
            continue;
        }
        let param = param1 || param2;
        replaced += ' ____ ';
        params.push([param, opt]);
    }

    let tokens = [], entities = [];
    try {
        const tokenized = await tokenizer.tokenize(language, replaced);
        tokens = tokenized.tokens;
        entities = tokenized.entities;
    } catch (e) {
        console.log(utterance);
        console.log(replaced);
        console.log(language);
        throw e;
    }

    if (Object.keys(entities).length > 0) {
        console.log(utterance);
        console.log(replaced);
        console.log(entities);
        throw new Error(`Error in Example ${id}: Cannot have entities in the utterance`);
    }

    let preprocessed = '';
    let first = true;
    for (let token of tokens) {
        if (token === '____') {
            let [param, opt] = params.shift();
            if (opt)
                token = '${' + param + ':' + opt + '}';
            else
                token = '${' + param + '}';
        } else if (token === '$') {
            token = '$$';
        }
        if (!first)
            preprocessed += ' ';
        preprocessed += token;
        first = false;
    }

    return preprocessed;
}

module.exports = {
    splitParams,
    split,
    clean,
    tokenizeExample,

    ENTITIES,
    makeDummyEntities(preprocessed) {
        const entities = {};
        for (let token of preprocessed.split(' ')) {
            if (/^[A-Z]/.test(token)) {
                if (token.startsWith('MEASURE_'))
                    entities[token] = makeDummyMeasure(token);
                else if (token.startsWith('GENERIC_ENTITY_'))
                    entities[token] = { value: token, display: token };
                else if (!(token in ENTITIES))
                    throw new Error(`missing entity ${token}`);
                else
                    entities[token] = ENTITIES[token];
            }
        }
        return entities;
    },

    renumberEntities(tokenized, context) {
        const { entities, tokens } = tokenized;
        const out = {};

        const offsets = {};
        for (let key in context) {
            const [, type, num] = /^(.+)_([0-9]+)$/.exec(key);
            if (type in offsets)
                offsets[type] = Math.max(num, offsets[type]);
            else
                offsets[type] = parseInt(num);

            out[key] = context[key];
        }

        const rewrites = {};

        for (let key in entities) {
            const [, type, num] = /^(.+)_([0-9]+)$/.exec(key);
            const value = entities[key];

            let found = false;
            for (let what in entities) {
                if (!what.startsWith(type + '_'))
                    continue;

                if (entitiesEqual(type, context[what], value)) {
                    found = true;
                    rewrites[key] = what;
                    break;
                }
            }

            if (!found) {
                let newnum;
                if (type in offsets)
                    newnum = parseInt(num) + offsets[type] + 1;
                else
                    newnum = num;
                const newkey = type + '_' + newnum;
                out[newkey] = entities[key];
                rewrites[key] = newkey;
            }
        }

        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] in rewrites)
                tokens[i] = rewrites[tokens[i]];
        }

        tokenized.entities = out;
    },

    isUnaryTableToTableOp(table) {
        return table.isFilter ||
            table.isProjection ||
            table.isCompute ||
            table.isAlias ||
            table.isAggregation ||
            table.isArgMinMax ||
            table.isSequence ||
            table.isHistory;
    },
    isUnaryStreamToTableOp(table) {
        return table.isWindow || table.isTimeSeries;
    },
    isUnaryStreamToStreamOp(stream) {
        return stream.isEdgeNew ||
            stream.isEdgeFilter ||
            stream.isFilter ||
            stream.isProjection ||
            stream.isCompute ||
            stream.isAlias;
    },
    isUnaryTableToStreamOp(stream) {
        return stream.isMonitor;
    }
};
