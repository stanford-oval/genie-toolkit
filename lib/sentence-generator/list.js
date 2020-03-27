// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// A lazy functional list with O(1) concatenation
class List {
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
module.exports = List;

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
