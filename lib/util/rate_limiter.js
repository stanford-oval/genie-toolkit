// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

class ListNode {
    constructor(data, prev, next) {
        this.data = data;
        this.prev = prev;
        this.next = next;
    }
}

class LinkedList {
    constructor() {
        this.head = null;
        this.tail = null;
        this.size = 0;
    }

    unshift(data) {
        if (this.head === null) {
            this.head = this.tail = new ListNode(data, null, null);
            this.size = 1;
        } else {
            this.head = new ListNode(data, null, this.head);
            this.head.next.prev = this.head;
            this.size ++;
        }
    }

    peek() {
        if (this.tail === null)
            return undefined;
        else
            return this.tail.data;
    }

    pop() {
        if (this.tail === null)
            throw new Error("Pop from an empty list");
        var data = this.tail.data;
        if (data.prev === null) {
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

module.exports = class RateLimiter {
    constructor(burst, interval) {
        this._queue = new LinkedList();
        this._burst = burst;
        this._interval = interval;
    }

    hit() {
        var now = Date.now();

        while (this._queue.size >= this._burst) {
            var oldest = this._queue.peek();
            if (now - oldest > this._interval)
                this._queue.pop();
            else
                return false;
        }
        this._queue.unshift(now);
        return true;
    }
}
