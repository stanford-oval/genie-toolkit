// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

function* stripOutTypeAnnotations(tokens) {
    for (let token of tokens) {
        if (token.startsWith('param:')) {
            let name = token.split(':')[1];
            yield 'param:'+name;
        } else {
            yield token;
        }
   }
}

function normalizeKeywordParams(program) {
    const newprogram = [];
    for (let i = 0; i < program.length; ) {
        const token = program[i];

        if (!token.startsWith('@')) {
            newprogram.push(token);
            i++;
            continue;
        }

        newprogram.push(token);
        i++;

        const params = {};
        while (i < program.length) {
            if (!program[i].startsWith('param:'))
                break;
            const pn = program[i].split(':')[1];
            i++;
            if (program[i] !== '=') // bad syntax
                break;
            i++;
            let in_string = program[i] === '"';
            const value = [program[i]];
            i++;

            while (i < program.length) {
                if (program[i] === '"')
                    in_string = !in_string;
                if (!in_string &&
                    (program[i].startsWith('param:') || ['on', '=>', '(', ')', '{', '}', 'filter', 'join'].indexOf(program[i]) >= 0))
                    break;
                value.push(program[i]);
                i++;
            }
            params[pn] = value;
        }

        const sorted = Object.keys(params);
        sorted.sort();
        for (let pname of sorted)
            newprogram.push('param:'+pname, '=', ...params[pname]);
    }
    return newprogram;
}

module.exports = {
    stripOutTypeAnnotations,
    normalizeKeywordParams
};
