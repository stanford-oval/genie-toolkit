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
// Author: Silei Xu <silei@cs.stanford.edu>

const specialTokens = [
    '_', // concatenation operator
    '*', // closure operator
    '|', // union operator
    '.', // wildcard character
    '[', // capturing group
    ']', // capturing group
    '(',
    ')'
];

const priorityMap : Record<string, number> = {
    '|': 0,
    '_': 1,
    '*': 2,
    '[': 0,
    ']': 0
};

function top(stack : string[]) : string|null {
    if (stack.length)
        return stack[stack.length - 1];
    return null;
}

function addConcatenationOp(template : string[]) : string[] {
    const added = [];
    for (let i = 0; i < template.length - 1; i++) {
        const current = template[i];
        const next = template[i+1];
        added.push(current);
        if (['|', '(', '['].includes(current))
            continue;
        if (['|', '*', ']', ')'].includes(next))
            continue;
        added.push('_');
    }
    added.push(template[template.length - 1]);
    return added;
}

function infixToPostfix(template : string[]) : string[] {
    const infix : string[] = addConcatenationOp(template);
    const postfix : string[] = [];
    const stack : string[] = [];
    for (const token of infix) {
        if (token === '(') {
            stack.push(token);
        } else if (token === ')') {
            while (top(stack) !== '(')
                postfix.push(stack.pop()!);
            stack.pop();
        } else if (specialTokens.includes(token) && !['.', '['].includes(token)) {
            while (stack.length > 0 && top(stack)! in priorityMap
                && priorityMap[top(stack)!] >= priorityMap[token])
                postfix.push(stack.pop()!);
            if (token === ']')
                postfix.push(token);
            else
                stack.push(token);
        } else {
            postfix.push(token);
        }
    }

    while (stack.length)
        postfix.push(stack.pop()!);

    return postfix;
}


export {
    specialTokens,
    infixToPostfix
};
