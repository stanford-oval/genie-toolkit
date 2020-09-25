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

// A lazy functional list with O(1) concatenation
export default class List {
    static concat(...lists) {
        let result = List.Nil;
        for (let i = lists.length-1; i >= 0; i--) {
            if (lists[i] instanceof List && result === List.Nil)
                result = lists[i];
            else if (lists[i] instanceof List)
                result = new List.Concat(lists[i], result);
            else
                result = new List.Cons(lists[i], result);
        }
        return result;
    }

    static singleton(el) {
        return new List.Cons(el, List.Nil);
    }

    static append(list, el) {
        return new List.Snoc(list, el);
    }
}

class NilClass extends List {
    traverse(cb) {
    }

    getFirst() {
        return null;
    }
}
List.Nil = new NilClass();

class Cons extends List {
    constructor(head, tail) {
        super();
        this.head = head;
        this.tail = tail;
    }

    traverse(cb) {
        cb(this.head);
        this.tail.traverse(cb);
    }

    getFirst() {
        return this.head;
    }
}
List.Cons = Cons;

class Snoc extends List {
    constructor(head, tail) {
        super();
        this.head = head;
        this.tail = tail;
    }

    traverse(cb) {
        this.head.traverse(cb);
        cb(this.tail);
    }

    getFirst() {
        return this.head.getFirst();
    }
}
List.Snoc = Snoc;

class Concat extends List {
    constructor(first, second) {
        super();
        this.first = first;
        this.second = second;
    }

    traverse(cb) {
        this.first.traverse(cb);
        this.second.traverse(cb);
    }

    getFirst() {
        return this.first.getFirst();
    }
}
List.Concat = Concat;
