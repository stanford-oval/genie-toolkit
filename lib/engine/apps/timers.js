// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>, Swee Kiat Lim <sweekiat@stanford.edu>
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

    _setTimems(date, timeInms) {
        // Takes and returns ms representation
        // 0 sets time to 0:00:00
        // 1000 sets time to 0:00:01
        // 43200000 sets time to 12:00:00
        let dateObj = new Date(date);
        return dateObj.setHours(null, null, null, timeInms);
    }

    _getTimems(date) {
        // Takes and returns ms representation
        // SOME_DATE 0:00:00 returns 0
        // SOME_DATE 0:00:01 returns 1000
        // SOME_DATE 12:00:00 returns 43200000
        let dateObj = new Date(date);
        let dateObj0 = new Date(date);
        return dateObj - this._setTimems(dateObj0, 0);
    }

    _setDay(date, day) {
        // Takes and returns ms representation
        let dateObj = new Date(date);
        let currentDay = dateObj.getDay();
        return date + (day - currentDay) * 86400000;
    }

    _splitDay(frequency) {
        // Takes frequency (per day) and returns reasonable timings

        const REASONABLE_START_TIME = 32400000; // 9AM
        const REASONABLE_INTERVAL = 43200000; // 12h
        const TIME_12PM = 43200000;

        let timings = [];
        if (frequency === null || frequency === 1) {
            // If it's just once a day, set timing as 12pm
            timings.push(TIME_12PM);
        } else {
            // For more than once a day, set interval as 9AM to 9PM
            // and divide equally starting from 9AM onwards
            // e.g. 3 times a day will be [9AM, 3PM, 9PM]
            // 4 times a day will be [9AM, 1PM, 5PM, 9PM]
            // Might want to set a limit on frequency?
            // Like if it is more than once per hour
            // then we just do simple divide
            let interval = REASONABLE_INTERVAL / (frequency - 1);
            for (let i = 0; i < frequency; i++)
                timings.push(Math.round(REASONABLE_START_TIME + i * interval));
        }
        return timings;
    }

    _splitWeek(frequency) {
        // Takes frequency (per week) and returns reasonable days
        // Days of week are 0-indexed, starting from Sunday
        let base_day = new Date(this._base).getDay();
        switch (frequency) {
            case 2:
                return [base_day, (base_day + 4) % 7];
            case 3:
                return [1, 3, 5];
            case 4:
                return [1, 2, 4, 5];
            case 5:
                return [1, 2, 3, 4, 5];
            case 6:
                return [1, 2, 3, 4, 5, 6];
            case 7:
                return [0, 1, 2, 3, 4, 5, 6];
            default:
                throw new Error("Invalid frequency for _splitWeek");
        }
    }

    _getEarliest(base, timings) {
        // Returns earliest valid timing after base
        // e.g. if timings = [9am, 3pm, 9pm] and base = 1st Jan 1pm
        // then next timing should be 1st Jan 3pm
        // if base = 1st Jan 10pm, next timing should be 2nd Jan 9am
        let earliest = null;
        for (let n = 0; n < timings.length; n++) {
            earliest = this._setTimems(base, timings[n]);
            if (earliest >= base)
                return earliest;
        }
        // If base is already past latest timing, return next day's timings[0]
        return this._setTimems(base + 86400000, timings[0]);
    }

    _nextTimeout(_now=null) {
        // Should we check for cases where frequency > interval?
        let interval = this._interval;
        let base = this._base;
        let now = _now === null ? Date.now() : _now; // used for testing
        let frequency = this._frequency === null ? 1 : this._frequency;
        let nextTiming = null;
        const DAY = 86400000;
        const WEEK = 7 * DAY;

        if (frequency === 0) { // End timer because it will never execute
            this.end();
            return 0;
        }
        else if ((this._interval / frequency) < 2000) {
            throw new Error(`Timer with total interval ${this._interval} and frequency ${this._frequency} will have intervals of ${this._interval / this._frequency}. Minimum interval is 2 seconds.`);
        }
        // Special case if interval is 1 day
        else if (this._interval === DAY) {
            let timings = this._splitDay(frequency);
            nextTiming = this._getEarliest(Math.max(now, base), timings);
        }
        // Special case if interval is 1 week
        else if (this._interval === WEEK) {
            if (base > now) {
                nextTiming = base;
            } else if (frequency === 1) {
                nextTiming = now + WEEK - ((now - base) % WEEK);
            } else if (frequency < 8) {
                // Hardcoded cases
                let days = this._splitWeek(frequency);
                let baseTime = this._getTimems(base);
                for (let n = 0; n < days.length; n++) {
                    nextTiming = this._setDay(now, days[n]);
                    nextTiming = this._setTimems(nextTiming, baseTime);
                    if (nextTiming >= now)
                        break;
                }
                if (nextTiming < now)
                    nextTiming = this._setDay(now + WEEK, days[0]);
                    nextTiming = this._setTimems(nextTiming, baseTime);
            } else {
                // Simple divide
                interval /= frequency;
                nextTiming = Math.round(now + interval - ((now - base) % interval));
            }
        }
        // Otherwise, just try to call at consistent times
        else if (this._interval > DAY) {
            if (base > now) {
                nextTiming = base;
            } else if (frequency <= (this._interval / DAY)) {
                // In this case, we are calling at most once a day
                // So just call at consistent time
                let baseTime = this._getTimems(base);
                interval /= frequency;
                nextTiming = Math.round(now + interval - ((now - base) % interval));
                nextTiming = this._setTimems(nextTiming, baseTime);
            } else {
                // Calling more than once a day.
                // Just do a simple divide
                interval /= frequency;
                nextTiming = Math.round(now + interval - ((now - base) % interval));
            }
        }
        // Just do simple divide if interval is less than a day
        else if (this._interval < DAY) {
            if (base > now) {
                nextTiming = base;
            } else {
                interval /= frequency;
                nextTiming = Math.round(now + interval - ((now - base) % interval));
            }
        }
        return nextTiming - now;
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
