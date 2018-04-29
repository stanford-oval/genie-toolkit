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

const AsyncQueue = require('consumer-queue');

class BaseTimer {
    constructor() {
        this._stopped = false;
        this._queue = new AsyncQueue();
        this._timeout = null;
    }

    next() {
        return this._queue.pop();
    }

    end() {
        if (this._stopped)
            return;
        this._stopped = true;
        this._queue.push({ done: true });
    }

    stop() {
        this._stopped = true;
        clearTimeout(this._timeout);
        this._timeout = null;
    }

    _reschedule() {
        this._timeout = setTimeout(() => {
            if (this._stopped)
                return;
            this._queue.push({ done: false, value: null });
            this._reschedule();
        }, this._nextTimeout());
    }

    start() {
        this._reschedule();
    }
}

class Timer extends BaseTimer {
    constructor(base, interval) {
        super();

        this._base = base;
        this._interval = interval;
    }

    toString() {
        return `[Timer ${this._base}, ${this._interval}]`;
    }

    _nextTimeout() {
        let now = Date.now();
        if (now < this._base)
            return this._base - now;
        let off = (now - this._base) % this._interval;
        return this._interval - off;
    }
}

class AtTimer extends BaseTimer {
    constructor(time) {
        super();

        this._time = time;
    }

    toString() {
        return `[AtTimer ${this._time}]`;
    }

    _nextTimeout() {
        var now = new Date;
        var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
            this._time.hour, this._time.minute, this._time.second, 0);
        var interval = target.getTime() - now.getTime();

        if (interval < 0)
            interval += 86400000; // try tomorrow

        console.log('At timer to ' + this._time + ': polling again in ' + interval + ' ms');
        return interval;
    }
}

module.exports = {
    Timer,
    AtTimer,
};
