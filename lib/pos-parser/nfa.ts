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

import assert from "assert";
import { infixToPostfix } from "./infix-to-postfix";

import EnglishLanguagePack from '../../lib/i18n/american-english';
import EnglishTokenizer from '../../lib/i18n/tokenizer/english';
import { TokenizerResult } from '../i18n';

interface Transition {
    token : string;
    from : State;
    to : State;
    capturing : boolean;
}

let stateCounter = 0;

class State {
    id : number;
    isEnd : boolean;
    transitions : Record<string, Transition[]>;

    constructor(isEnd = false) {
        this.id = stateCounter++;
        this.isEnd = isEnd;
        this.transitions = {};
    }

    addTransition(token : string, to : State, capturing = false) {
        if (this.isEnd) {
            // order matters: if it's a self-loop, `isEnd` remains true
            this.isEnd = false;
            to.isEnd = true;
        }
        if (token in this.transitions)
            this.transitions[token].push({ token, from: this, to, capturing });
        else
            this.transitions[token] = [{ token, from: this, to, capturing }];
    }
}

interface Token {
    token : string,
    pos : string|undefined
}

function arrayMatch(a : string[], b : string[]) : number {
    return a.findIndex((element, i) => {
        for (let j = 0; j < b.length; j++) {
            if (i + j > a.length - 1)
                return false;
            if (a[i + j] !== b[j])
                return false;
        }
        return true;
    });
}

function arrayMatchCount(a : string[], b : string[]) : number {
    let count = 0;
    for (let i = 0; i < a.length - b.length + 1; i++) {
        let match = true;
        for (let j = 0; j < b.length; j++) {
            if (a[i + j] !== b[j])
                match = false;
        }
        if (match)
            count += 1;
    }
    return count;
}

export class NFA {
    start : State;
    end : State;
    private languagePack : EnglishLanguagePack;
    private tokenizer : EnglishTokenizer;

    constructor(start ?: State, end ?: State) {
        this.start = start || new State(false);
        this.end = end || new State(true);
        this.languagePack = new EnglishLanguagePack();
        this.tokenizer = this.languagePack.getTokenizer();
    }

    private preprocess(utterance : string, domainCanonicals : string[], value : string) : Token[] {
        // remove punctuation at the end
        utterance = utterance.replace(/[.,?!;]\s*$/g, '');

        const tokenized : TokenizerResult = this.tokenizer.tokenize(utterance);
        const tokens = tokenized.rawTokens;
        const posTags : Array<string|undefined> = this.languagePack.posTag(tokenized.rawTokens);



        // replace value with special token $value
        if (arrayMatchCount(tokens, value.split(' ')) !== 1)
            return [];
        const valueIndex = arrayMatch(tokens, value.split(' '));
        posTags[valueIndex] = undefined;
        posTags.splice(valueIndex, value.split(' ').length - 1);
        tokens[valueIndex] = '$value';
        tokens.splice(valueIndex, value.split(' ').length - 1);

        // expand domain canonicals to include plurals
        const domainCanonicalsExpanded : Set<string> = new Set();
        for (const canonical of domainCanonicals) {
            domainCanonicalsExpanded.add(canonical);
            domainCanonicalsExpanded.add(this.languagePack.pluralize(canonical));
        }

        // replace domain canonical with special token $domain
        let domainCanonical : string;
        let matchCount = 0;
        for (const canonical of domainCanonicalsExpanded) {
            const count : number = arrayMatchCount(tokens, canonical.split(' '));
            if (count > 0)
                domainCanonical = canonical;
            matchCount += count;
        }
        if (matchCount !== 1)
            return [];
        const domainCanonicalIndex : number = arrayMatch(tokens, domainCanonical!.split(' '));
        posTags[domainCanonicalIndex] = undefined;
        posTags.splice(domainCanonicalIndex, value.split(' ').length - 1);
        tokens[domainCanonicalIndex] = '$domain';
        tokens.splice(domainCanonicalIndex, value.split(' ').length - 1);

        return Array.from(tokens.keys()).map((i) => {
            return { token : tokens[i], pos : posTags[i] };
        });
    }

    match(utterance : string, domainCanonical : string[], value : string) : string|null {
        const preprocessed = this.preprocess(utterance, domainCanonical, value);
        if (preprocessed.length === 0)
            return null;

        // `history` records capturing tokens to reach to each state, where key is the state id
        // this is find since there is no back loop
        const history : Record<number, string[]> = {};
        let current : State[] = NFA.getClosure(this.start);
        let next : Set<State>;

        // given a transition, add possible states to `next`, and update history for each state
        function addToNext(token : Token, transition : Transition) {
            NFA.getClosure(transition.to).forEach((to) => {
                if (transition.capturing)
                    history[to.id] = [...(history[transition.from.id] || []), token.token];
                else
                    history[to.id] = [...(history[transition.from.id] || [])];
                next.add(to);
            });
        }

        for (const token of preprocessed) {
            if (current.length === 0)
                return null;

            next = new Set();
            for (const state of current) {
                // token match
                if (token.token in state.transitions)
                    state.transitions[token.token].forEach(addToNext.bind(null, token));
                // part-of-speech tag match
                if (token.pos && token.pos in state.transitions)
                    state.transitions[token.pos].forEach(addToNext.bind(null, token));
                // wild card match
                if ('.' in state.transitions)
                    state.transitions['.'].forEach(addToNext.bind(null, token));
            }
            current = Array.from(next);
        }

        const match = current.find((state : State) => state.isEnd);
        if (match)
            return history[match.id].join(' ');
        return null;
    }

    private static getClosure(state : State) : State[] {
        const visited = [state];
        const stack = [state];
        while (stack.length) {
            const state : State = stack.pop()!;
            if ('ε' in state.transitions) {
                for (const transition of state.transitions['ε']) {
                    if (!visited.includes(transition.to)) {
                        visited.push(transition.to);
                        stack.push(transition.to);
                    }
                }
            }
        }
        return visited;
    }
}

function edge(token : string, capturing = false) : NFA {
    const start = new State(false);
    const end = new State(true);

    start.addTransition(token, end, capturing);
    return new NFA(start, end);
}

function union(a : NFA, b : NFA) : NFA {
    const start = new State(false);
    const end = new State(true);

    start.addTransition('ε', a.start);
    start.addTransition('ε', b.start);

    a.end.addTransition('ε', end);
    b.end.addTransition('ε', end);

    return new NFA(start, end);
}


function concat(a : NFA, b : NFA) : NFA {
    a.end.addTransition('ε', b.start);
    return new NFA(a.start, b.end);
}

function closure(a : NFA) : NFA {
    const start = new State(false);
    const end = new State(true);

    start.addTransition('ε', a.start);
    start.addTransition('ε', a.end);

    a.end.addTransition('ε', a.start);
    a.end.addTransition('ε', end);

    return new NFA(start, end);
}

function toNFA(template : string[]) : NFA {
    template = infixToPostfix(template);
    const stack : NFA[] = [];

    let capturing = false;
    for (const token of template) {
        if (token === '[') {
            capturing = true;
        } else if (token === ']') {
            capturing = false;
        } else if (token === '_') { // concat
            const b : NFA = stack.pop()!;
            const a : NFA = stack.pop()!;
            stack.push(concat(a, b));
        } else if (token === '|') { // union
            const b : NFA = stack.pop()!;
            const a : NFA = stack.pop()!;
            stack.push(union(a, b));
        } else if (token === '*') { // closure
            const a : NFA = stack.pop()!;
            stack.push(closure(a));
        } else {
            stack.push(edge(token, capturing));
        }
    }

    assert(stack.length === 1);
    return stack.pop()!;
}

export {
    toNFA
};
