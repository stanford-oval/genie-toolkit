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
