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
        // Should we check for cases where frequency > interval?
        let interval = this._interval;
        let base = this._base;
        let now = Date.now();
        let next_timing = null;
        const DAY = 86400000;
        const HALFDAY = 43200000;
        const TIME_9AM = 32400000;
        const TIME_12PM = HALFDAY;

        if (this._frequency === 0) { // End timer because it will never execute
            this.stop(); // Not sure if we should use this.end() or this.stop()
            return 0;
        }

        // Now we are just making sure that we call at consistent times
        // using time of base e.g. if base is at 3pm, we will call at 3pm
        // on every day that we raise the alert
        if (this._interval > DAY) {
            if (base > now) {
                next_timing = base;
            } else if (this._frequency === null || this._frequency <= (this._interval / DAY)) {
                // In this case, we are calling at most once a day
                // So just call at consistent time
                // Not sure if we want to hard code more stuff
                // e.g. 3 times a week means Mon, Wed, Fri etc.
                let startDateObj = new Date(base);
                startDateObj.setHours(null, null, null, 0);
                let base_time = base - startDateObj;
                interval /= this._frequency;
                next_timing = Math.round(now + interval - ((now - base) % interval));
                next_timing = new Date(next_timing);
                next_timing.setHours(null, null, null, base_time);
            } else {
                // Calling more than once a day.
                // User is being weird?
                // Just do a simple divide
                interval /= this._frequency;
                next_timing = Math.round(now + interval - ((now - base) % interval));
            }
        }

        // Just do simple divide if interval is less than a day
        if (this._interval < DAY) {
            if (base > now) {
                next_timing = base;
            } else {
                interval /= this._frequency;
                next_timing = Math.round(now + interval - ((now - base) % interval));
            }
        }

        if (this._interval === DAY) {
            let timings = [];
            if (this._frequency === null || this._frequency === 1) {
                // If it's just once a day, set timing as 12pm
                timings.push(TIME_12PM); // 12pm
            } else {
                // For more than once a day, set interval as 9AM to 9PM
                // and divide equally starting from 9AM onwards
                // e.g. 3 times a day will be [9AM, 3PM, 9PM]
                // 4 times a day will be [9AM, 1PM, 5PM, 9PM]
                // Might want to set a limit on frequency?
                // Like if it is more than once per hour
                // then we just do simple divide
                timings.push(TIME_9AM); // 9AM
                interval = HALFDAY; // 9AM to 9PM
                interval /= (this._frequency - 1);
                for (var i = 0; i < (this._frequency - 1); i++) timings.push(Math.round(TIME_9AM + interval));
            }

            let threshold = Math.max(now, base);
            next_timing = new Date(threshold);

            // Set next timing as the earliest timing after threshold (base or now)
            // e.g. if timings = [9am, 3pm, 9pm] and threshold = 1st Jan 1pm
            // next timing should be 1st Jan 3pm
            // TODO - there's a faster way than doing a while loop
            let n = 0;
            next_timing.setHours(null, null, null, timings[n]);
            while (next_timing < threshold) {
                if (n === timings.length - 1) {
                    // Went past the latest timing, go to first timing of next day
                    next_timing.setHours(null, null, null, timings[0]);
                    next_timing = next_timing.valueOf() + DAY;
                    break;
                }
                next_timing.setHours(null, null, null, timings[++n]);
            }
        }
        return next_timing - now;
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
