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
    constructor(base, interval, frequency) {
        super();

        this._base = base;
        this._interval = interval;
        this._frequency = frequency;
    }

    toString() {
        return `[Timer ${this._base}, ${this._interval}, ${this._frequency}]`;
    }

    _nextTimeout() {
        let interval = this._interval;
        if (this._frequency === 0) { // End timer because it will never execute
            this.end();
            return 86400000;
        }
        if (this._frequency !== null) {
            interval /= this._frequency;
        }
        let now = Date.now();
        if (now < this._base)
            return this._base - now;
        let off = (now - this._base) % interval;
        return interval - off;
    }
}

class AtTimer extends BaseTimer {
    constructor(times, expiration_date) {
        super();

        this._times = times;
        this._expiration_date = expiration_date;
    }

    toString() {
        return `[AtTimer [${this._times}], ${this._expiration_date}]`;
    }

    _nextTimeout() {
        var now = new Date;

        if (this._expiration_date !== null && this._expiration_date < now) {
            console.log('AtTimer to the times ' + this._times + ': has hit expiration date of ' + this._expiration_date);
            this.end();
            return 86400000;
        }

        var interval = 86400000; // Tomorrow
        for (let i = 0; i < this._times.length; i++) {
            let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                this._times[i].hour, this._times[i].minute, this._times[i].second, 0);
            let newInterval = target.getTime() - now.getTime();
            if (newInterval < interval && newInterval >= 0)
                interval = newInterval;
        }

        console.log('AtTimer to the times ' + this._times + ': polling again in ' + interval + ' ms');
        return interval;
    }
}

module.exports = {
    Timer,
    AtTimer,
};
