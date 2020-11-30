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

class State {
    isEnd : boolean;
    transitions : Record<string, State[]>;

    constructor(isEnd = false) {
        this.isEnd = isEnd;
        this.transitions = {};
    }

    addTransition(token : string, to : State) {
        if (this.isEnd) {
            // order matters: if it's a self-loop, `isEnd` remains true
            this.isEnd = false;
            to.isEnd = true;
        }
        if (token in this.transitions)
            this.transitions[token].push(to);
        else
            this.transitions[token] = [to];
    }
}

export class NFA {
    start : State;
    end : State;

    constructor(start ?: State, end ?: State) {
        this.start = start || new State(false);
        this.end = end || new State(true);
    }

    match(expression : string[]) : boolean {
        let current : State[] = NFA._getClosure(this.start);

        for (const token of expression) {
            if (current.length === 0)
                return false;

            const next : Set<State> = new Set();
            for (const state of current) {
                if (token in state.transitions) {
                    for (const nextState of state.transitions[token])
                        NFA._getClosure(nextState).forEach(next.add, next);
                }
            }
            current = Array.from(next);
        }

        return current.some((state : State) => state.isEnd);
    }

    static _getClosure(state : State) : State[] {
        const visited = [state];
        const stack = [state];
        while (stack.length) {
            const state : State = stack.pop()!;
            if ('ε' in state.transitions) {
                for (const s of state.transitions['ε']) {
                    if (!visited.includes(s)) {
                        visited.push(s);
                        stack.push(s);
                    }
                }
            }
        }
        return visited;
    }
}

function edge(token : string) : NFA {
    const start = new State(false);
    const end = new State(true);

    start.addTransition(token, end);
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

function toNFA(template : string[]) {
    template = infixToPostfix(template);
    const stack : NFA[] = [];

    for (const token of template) {
        if (token === '_') { // concat
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
            stack.push(edge(token));
        }
    }

    assert(stack.length === 1);
    return stack.pop();
}

export {
    toNFA
};
