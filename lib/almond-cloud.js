// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file contains code copied from Almond-Cloud
// https://github.com/stanford-oval/almond-cloud/blob/master/util/tokenize.js
// https://github.com/stanford-oval/almond-cloud/blob/master/util/validation.js
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University and National Taiwan University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu> and Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>
//
// See COPYING for details
"use strict";

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
    PARAM_REGEX,
    split,
    splitParams,
    tokenizeExample
};
