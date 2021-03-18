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
import { infixToPostfix, specialTokens } from "./infix-to-postfix";

import EnglishLanguagePack from '../../lib/i18n/english';
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

function posMatch(current : Token, next : Token|null, transitions : Record<string, Transition[]>) {
    if (!current.pos)
        return false;

    // do not match part-of-speech for special token "$domain"
    // "$value", on the other hand, is allowed (used in reverse_property templates)
    if (current.token === '$domain')
        return false;

    if (!(current.pos in transitions))
        return false;

    if (current.pos === 'IN' && current.token === 'with')
        return false;

    if (current.pos.startsWith('V')) {
        if (['has', 'have', 'had'].includes(current.token))
            return next && ['VBN', 'VBG'].includes(next.pos!);
        if (['is', 'are', 'was', 'were'].includes(current.token))
            return false;
    }

    return true;
}

export class NFA {
    start : State;
    end : State;
    private languagePack : EnglishLanguagePack;
    private tokenizer : EnglishTokenizer;

    constructor(start ?: State, end ?: State) {
        this.start = start || new State(false);
        this.end = end || new State(true);
        this.languagePack = new EnglishLanguagePack('en');
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
        posTags[valueIndex] = 'NN';
        posTags.splice(valueIndex + 1, value.split(' ').length - 1);
        tokens[valueIndex] = '$value';
        tokens.splice(valueIndex + 1, value.split(' ').length - 1);

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
        if (matchCount > 1)
            return [];
        if (matchCount !== 0) {
            const domainCanonicalIndex : number = arrayMatch(tokens, domainCanonical!.split(' '));
            posTags[domainCanonicalIndex] = 'NN';
            posTags.splice(domainCanonicalIndex + 1, domainCanonical!.split(' ').length - 1);
            tokens[domainCanonicalIndex] = '$domain';
            tokens.splice(domainCanonicalIndex + 1, domainCanonical!.split(' ').length - 1);
        }

        return Array.from(tokens.keys()).map((i) => {
            return { token : tokens[i], pos : posTags[i] };
        });
    }

    match(utterance : string, domainCanonical : string[], value : string) : string|null {
        value = this.tokenizer.tokenize(value).rawTokens.join(' ');
        const preprocessed = this.preprocess(utterance, domainCanonical, value);
        if (preprocessed.length === 0)
            return null;

        // `history` records capturing tokens to reach to each state, where key is the state id
        // this is find since there is no back loop
        const history : Record<number, string[]> = {};
        let current : State[] = NFA.getClosure(this.start);

        for (let i = 0; i < preprocessed.length; i++) {
            const token = preprocessed[i];
            const nextToken = i === preprocessed.length - 1 ? null : preprocessed[i+1];
            if (current.length === 0)
                return null;


            const transitions : Transition[] = [];
            for (const state of current) {
                // token match
                if (token.token in state.transitions)
                    state.transitions[token.token].forEach((t) => transitions.push(t));
                // part-of-speech tag match
                if (posMatch(token, nextToken, state.transitions))
                    state.transitions[token.pos!].forEach((t) => transitions.push(t));
            }

            // wild card match, apply only when no token/pos match found
            if (transitions.length === 0) {
                for (const state of current) {

                    if ('.' in state.transitions)
                        state.transitions['.'].forEach((t) => transitions.push(t));
                }
            }

            // reset current states and update history
            current = [];
            const historyUpdated : Set<number> = new Set();
            const historyBeforeUpdate : Record<number, string[]> = {};
            for (const transition of transitions) {
                NFA.getClosure(transition.to).forEach((to) => {
                    if (historyUpdated.has(to.id))
                        return;
                    current.push(to);
                    historyBeforeUpdate[to.id] = history[to.id];
                    if (transition.capturing)
                        history[to.id] = [...(historyBeforeUpdate[transition.from.id] || history[transition.from.id] || []), token.token];
                    else
                        history[to.id] = [...(historyBeforeUpdate[transition.from.id] || history[transition.from.id] || [])];
                    historyUpdated.add(to.id);
                });
            }
        }

        const match = current.find((state : State) => state.isEnd);
        if (match)
            return history[match.id].join(' ');
        return null;
    }

    print() {
        const visited = [this.start];
        const stack = [this.start];
        while (stack.length) {
            const state : State = stack.pop()!;
            console.log(`${state.id} ${state.isEnd ? '(end)' : ''}`);
            for (const token in state.transitions) {
                for (const transition of state.transitions[token]) {
                    if (!visited.includes(transition.to)) {
                        visited.push(transition.to);
                        stack.push(transition.to);
                    }
                }
                console.log(`\t${token}: ${state.transitions[token].map((t) => t.to.id)}`);
            }
        }
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

    a.end.isEnd = false;
    b.end.isEnd = false;

    return new NFA(start, end);
}


function concat(a : NFA, b : NFA) : NFA {
    a.end.addTransition('ε', b.start);
    a.end.isEnd = false;
    return new NFA(a.start, b.end);
}

function closure(a : NFA) : NFA {
    const start = new State(false);
    const end = new State(true);

    start.addTransition('ε', a.start);
    start.addTransition('ε', a.end);

    a.end.addTransition('ε', a.start);
    a.end.addTransition('ε', end);

    a.end.isEnd = false;

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
    specialTokens,
    toNFA
};
