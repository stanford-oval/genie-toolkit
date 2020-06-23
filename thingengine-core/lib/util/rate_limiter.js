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

const LinkedList = require('./linked_list');

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
};
