// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// A Set-like class that uses an Array as backing store, and thus can
// be stored transparently to and from JSON
module.exports = class ArraySet {
    constructor(store) {
        this.store = store || [];
    }
    toJSON() {
        return this.store;
    }
    get size() {
        return this.store.length;
    }
    add(elem) {
        let idx = this.store.indexOf(elem);
        if (idx >= 0)
            return false;
        this.store.push(elem);
        return true;
    }
    delete(elem) {
        let idx = this.store.indexOf(elem);
        if (idx < 0)
            return false;
        this.store.splice(idx, 1);
        return true;
    }
    has(elem) {
        return this.store.indexOf(elem) >= 0;
    }
    clear() {
        this.store = [];
    }
    forEach(callback, thisArg) {
        this.store.forEach((value) => {
            callback.call(thisArg, value, value, this);
        });
    }

    values() {
        return this.store[Symbol.iterator]();
    }
    keys() {
        return this.values();
    }
    [Symbol.iterator]() {
        return this.values();
    }
};