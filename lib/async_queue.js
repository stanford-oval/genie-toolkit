// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

module.exports = class AsyncQueue {
    constructor() {
        this._head = null;
        this._tail = null;
        this._waiter = null;
        this._cancel = null;
    }

    tryPop() {
        if (this._head !== null) {
            let data = this._head.data;
            this._head = this._head.next;
            if (this._head === null)
                this._tail = null;
        } else {
            return null;
        }
    }

    pop() {
        if (this._head !== null) {
            return Promise.resolve(this.tryPop());
        } else if (this._waiter !== null) {
            throw new Error('Someone is already waiting on this queue');
        } else {
            return new Promise((callback, errback) => {
                this._waiter = callback;
                this._cancel = errback;
            });
        }
    }
    cancelWait(err) {
        let cancel = this._cancel;
        this._cancel = null;
        this._waiter = null;
        if (cancel)
            cancel(err);

    }

    hasWaiter() {
        return this._waiter !== null;
    }

    push(data) {
        let waiter = this._waiter;
        this._waiter = null;
        this._cancel = null;
        if (waiter)
            waiter(data);
        else if (this._tail === null)
            this._head = this._tail = { data: data, next: null };
        else
            this._tail.next = { data: data, next: null };
    }
}
