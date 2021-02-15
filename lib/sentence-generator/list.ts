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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


// A lazy functional list with O(1) concatenation
export default abstract class List<T> {
    static Nil : List<never>;

    static concat<T>(...lists : Array<T|List<T>>) : List<T> {
        let result : List<T> = List.Nil;
        for (let i = lists.length-1; i >= 0; i--) {
            if (lists[i] instanceof List && result === List.Nil)
                result = lists[i] as List<T>;
            else if (lists[i] instanceof List)
                result = new Concat<T>(lists[i] as List<T>, result);
            else
                result = new Cons<T>(lists[i] as T, result);
        }
        return result;
    }

    static join<T>(l1 : List<T>, l2 : List<T>) : List<T> {
        if (l1 === List.Nil)
            return l2;
        return new Concat<T>(l1, l2);
    }

    static singleton<T>(el : T) : List<T> {
        return new Cons<T>(el, List.Nil);
    }

    static append<T>(list : List<T>, el : T) : List<T> {
        return new Snoc(list, el);
    }

    abstract traverse(cb : (x : T) => void) : void;
    abstract getFirst() : T;
}

class NilClass extends List<never> {
    traverse(cb : (x : never) => void) : void {
    }

    getFirst() : never {
        throw new Error('getFirst on an empty list');
    }
}
List.Nil = new NilClass();

class Cons<T> extends List<T> {
    constructor(public head : T,
                public tail : List<T>) {
        super();
    }

    traverse(cb : (x : T) => void) : void {
        cb(this.head);
        this.tail.traverse(cb);
    }

    getFirst() : T {
        return this.head;
    }
}

class Snoc<T> extends List<T> {
    constructor(public head : List<T>,
                public tail : T) {
        super();
    }

    traverse(cb : (x : T) => void) : void {
        this.head.traverse(cb);
        cb(this.tail);
    }

    getFirst() : T {
        return this.head.getFirst();
    }
}

class Concat<T> extends List<T> {
    constructor(public first : List<T>,
                public second : List<T>) {
        super();
        this.first = first;
        this.second = second;
    }

    traverse(cb : (x : T) => void) : void {
        this.first.traverse(cb);
        this.second.traverse(cb);
    }

    getFirst() : T {
        return this.first.getFirst();
    }
}
