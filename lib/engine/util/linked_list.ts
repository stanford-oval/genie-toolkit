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


class ListNode<T> {
    constructor(public data : T,
                public prev : ListNode<T>|null,
                public next : ListNode<T>|null) {
    }
}

export default class LinkedList<T> {
    private head : ListNode<T>|null;
    private tail : ListNode<T>|null;
    size : number;

    constructor() {
        this.head = null;
        this.tail = null;
        this.size = 0;
    }

    *[Symbol.iterator]() : Iterator<T> {
        let node = this.head;
        while (node !== null) {
            yield node.data;
            node = node.next;
        }
    }

    unshift(data : T) : void {
        if (this.head === null) {
            this.head = this.tail = new ListNode(data, null, null);
            this.size = 1;
        } else {
            this.head = new ListNode(data, null, this.head);
            this.head.next!.prev = this.head;
            this.size ++;
        }
    }

    peek() : T|undefined {
        if (this.tail === null)
            return undefined;
        else
            return this.tail.data;
    }

    pop() : T {
        if (this.tail === null)
            throw new Error("Pop from an empty list");
        const data = this.tail.data;
        if (this.tail.prev === null) {
            this.head = this.tail = null;
            this.size = 0;
        } else {
            this.tail.prev.next = null;
            this.tail = this.tail.prev;
            this.size --;
        }
        return data;
    }
}
