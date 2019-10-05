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

const assert = require('assert');
const Inflectors = require('en-inflectors').Inflectors;
const Tag = require('en-pos').Tag;

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.code = 'EINVAL';
    }
}

function clean(name) {
    if (/^[vwgp]_/.test(name))
        name = name.substr(2);
    return name.replace(/_/g, ' ').replace(/([^A-Z ])([A-Z])/g, '$1 $2').toLowerCase();
}

function pluralize(name) {
    if (!name.includes(' ')) {
        if (new Tag([name]).initial().tags[0] === 'NN')
            return new Inflectors(name).toPlural();
        return name;
    } else {
        const words = name.split(' ');
        const tags = new Tag(words).initial().tags;
        if (tags[tags.length - 1] !== 'NN')
            return name;
        else if (['VB', 'VBP', 'VBZ', 'VBD'].includes(tags[0]))
            return name;
        words[words.length - 1] = pluralize(words[words.length - 1]);
        return words.join(' ');
    }
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
    DURATION: (idx) => ({ value: idx + 2, unit: 'ms' }),
    NUMBER: (idx) => idx + 2,
    DATE: (idx) => ({ day: idx + 1, month: 1, year: 2018 }),
    TIME: (idx) => ({ hour: 0, minute: idx + 1, second: 0 }),
    CURRENCY: (idx) => ({ value: idx + 2, unit: 'usd' }),
    LOCATION: (idx) => ({ latitude: idx + 2, longitude: idx + 2 }),
    QUOTED_STRING: (idx) => `"${idx}"`,
    PATH_NAME: (idx) => `foo/${idx}.png`,
    URL: (idx) => `https://${idx}.com`,
    PHONE_NUMBER: (idx) => `+1${idx+1}`,
    EMAIL_ADDRESS: (idx) => `${idx+1}@foo.com`,
    USERNAME: (idx) => `@${idx+1}`,
    HASHTAG: (idx) => `#${idx+1}`,
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

    const tokenized = await tokenizer.tokenize(language, replaced);
    const tokens = tokenized.tokens;
    const entities = tokenized.entities;

    if (Object.keys(entities).length > 0)
        throw new ValidationError(`Error in Example ${id}: Cannot have entities in the utterance`);

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

const ENTITY_MATCH_REGEX = /^([A-Z].*)_([0-9]+)$/;

function makeDummyEntity(token) {
    const [,entityType,entityIndex] = ENTITY_MATCH_REGEX.exec(token);
    assert(!Number.isNaN(Number(entityIndex)), token);

    if (entityType === 'MEASURE')
        return makeDummyMeasure(token);
    else if (entityType.startsWith('GENERIC_ENTITY_'))
        return { value: token, display: token };
    else if (!(entityType in ENTITIES))
        throw new Error(`missing entity ${token}`);
    else
        return ENTITIES[entityType](Number(entityIndex));
}

module.exports = {
    splitParams,
    split,
    clean,
    pluralize,
    tokenizeExample,

    makeDummyEntity,
    makeDummyEntities(preprocessed) {
        const entities = {};
        for (let token of preprocessed.split(' ')) {
            if (/^[A-Z]/.test(token))
                entities[token] = makeDummyEntity(token);
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
    }
};
