// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>, Swee Kiat Lim <sweekiat@stanford.edu>

import { Temporal } from '@js-temporal/polyfill';

import * as ThingTalk from 'thingtalk';
import AsyncQueue from 'consumer-queue';

abstract class BaseTimer {
    private _stopped : boolean;
    private _queue : AsyncQueue<IteratorResult<{ __timestamp : number }, void>>;
    private _timeout : NodeJS.Timeout|null;

    constructor() {
        this._stopped = false;
        this._queue = new AsyncQueue();
        this._timeout = null;
    }

    protected abstract _nextTimeout() : number;

    next() {
        return this._queue.pop();
    }

    end() {
        if (this._stopped)
            return;
        this._stopped = true;
        this._queue.push({ done: true, value: undefined });
    }

    stop() {
        this._stopped = true;
        clearTimeout(this._timeout!);
        this._timeout = null;
    }

    private _reschedule() {
        this._timeout = setTimeout(() => {
            if (this._stopped)
                return;
            this._queue.push({ done: false, value: { __timestamp: Date.now() } });
            this._reschedule();
        }, this._nextTimeout());
    }

    start() {
        this._reschedule();
    }
}

class Timer extends BaseTimer {
    private _base : number;
    private _interval : number;
    private _frequency : number;

    constructor(base : number, interval : number, frequency : number) {
        super();

        if (Number.isNaN(base) || Number.isNaN(interval) || Number.isNaN(frequency))
            throw new Error(`Invalid timer`);

        this._base = base;
        this._interval = interval;
        this._frequency = frequency;
    }

    toString() {
        return `[Timer ${this._base}, ${this._interval}, ${this._frequency}]`;
    }

    private _setTimems(date : number|Date, timeInms : number) {
        // Takes and returns ms representation
        // 0 sets time to 0:00:00
        // 1000 sets time to 0:00:01
        // 43200000 sets time to 12:00:00
        const dateObj = new Date(date);
        return dateObj.setHours(0, 0, 0, timeInms);
    }

    private _getTimems(date : number) {
        // Takes and returns ms representation
        // SOME_DATE 0:00:00 returns 0
        // SOME_DATE 0:00:01 returns 1000
        // SOME_DATE 12:00:00 returns 43200000
        const dateObj = new Date(date);
        const dateObj0 = new Date(date);
        return dateObj.getTime() - this._setTimems(dateObj0, 0);
    }

    private _setDay(date : number, day : number) {
        // Takes and returns ms representation
        const dateObj = new Date(date);
        const currentDay = dateObj.getDay();
        return date + (day - currentDay) * 86400000;
    }

    private _splitDay(frequency : number) {
        // Takes frequency (per day) and returns reasonable timings

        const REASONABLE_START_TIME = 32400000; // 9AM
        const REASONABLE_INTERVAL = 43200000; // 12h
        const TIME_12PM = 43200000;

        const timings = [];
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
            const interval = REASONABLE_INTERVAL / (frequency - 1);
            for (let i = 0; i < frequency; i++)
                timings.push(Math.round(REASONABLE_START_TIME + i * interval));
        }
        return timings;
    }

    private _splitWeek(frequency : number) {
        // Takes frequency (per week) and returns reasonable days
        // Days of week are 0-indexed, starting from Sunday
        const base_day = new Date(this._base).getDay();
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

    private _getEarliest(base : number, timings : number[]) {
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

    protected _nextTimeout(_now : number|null = null) {
        // Should we check for cases where frequency > interval?
        let interval = this._interval;
        const base = this._base;
        const now = _now === null ? Date.now() : _now; // used for testing
        const frequency = this._frequency === null ? 1 : this._frequency;
        const DAY = 86400000;
        const WEEK = 7 * DAY;

        let nextTiming = 0;
        if (frequency === 0) { // End timer because it will never execute
            this.end();
            return 0;
        } else if ((this._interval / frequency) < 2000) {
            throw new Error(`Timer with total interval ${this._interval} and frequency ${this._frequency} will have intervals of ${this._interval / this._frequency}. Minimum interval is 2 seconds.`);
        } else if (this._interval === DAY) {
            // Special case if interval is 1 day
            const timings = this._splitDay(frequency);
            nextTiming = this._getEarliest(Math.max(now, base), timings);
        } else if (this._interval === WEEK) {
            // Special case if interval is 1 week
            if (base > now) {
                nextTiming = base;
            } else if (frequency === 1) {
                nextTiming = now + WEEK - ((now - base) % WEEK);
            } else if (frequency < 8) {
                // Hardcoded cases
                const days = this._splitWeek(frequency);
                const baseTime = this._getTimems(base);
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
        } else if (this._interval > DAY) {
            // Otherwise, just try to call at consistent times
            if (base > now) {
                nextTiming = base;
            } else if (frequency <= (this._interval / DAY)) {
                // In this case, we are calling at most once a day
                // So just call at consistent time
                const baseTime = this._getTimems(base);
                interval /= frequency;
                nextTiming = Math.round(now + interval - ((now - base) % interval));
                nextTiming = this._setTimems(nextTiming, baseTime);
            } else {
                // Calling more than once a day.
                // Just do a simple divide
                interval /= frequency;
                nextTiming = Math.round(now + interval - ((now - base) % interval));
            }
        } else if (this._interval < DAY) {
            // Just do simple divide if interval is less than a day
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
    private _times : ThingTalk.Builtin.Time[];
    private _expiration_date : Date|null|undefined;
    private _timezone : string;

    constructor(times : ThingTalk.Builtin.Time[], expiration_date : Date|null|undefined, timezone : string) {
        super();

        this._times = times;
        this._expiration_date = expiration_date;
        if (this._expiration_date && Number.isNaN(this._expiration_date.getTime()))
            throw new Error(`Invalid timer`);
        this._timezone = timezone;
    }

    toString() {
        return `[AtTimer [${this._times}], ${this._expiration_date}]`;
    }

    protected _nextTimeout() {
        const now = Temporal.Now.zonedDateTime('iso8601', this._timezone);

        if (this._expiration_date !== undefined && this._expiration_date !== null &&
            this._expiration_date.getTime() < now.epochMilliseconds) {
            console.log('AtTimer to the times ' + this._times + ': has hit expiration date of ' + this._expiration_date);
            this.end();
            return 86400000;
        }

        let interval = 86400000; // Tomorrow
        for (let i = 0; i < this._times.length; i++) {
            const target = now.withPlainTime(new Temporal.PlainTime(this._times[i].hour,
                this._times[i].minute, this._times[i].second, 0));
            const newInterval = target.epochMilliseconds - now.epochMilliseconds;
            if (newInterval < interval && newInterval >= 0)
                interval = newInterval;
        }

        console.log('AtTimer to the times ' + this._times + ': polling again in ' + interval + ' ms');
        return interval;
    }
}

class OnTimer extends BaseTimer {
    private _dates : Date[];

    constructor(dates : Date[]) {
        super();

        this._dates = dates;
        if (dates.some((d) => Number.isNaN(d.getTime())))
            throw new Error(`Invalid timer`);
    }

    toString() {
        return `[OnTimer [${this._dates}]]`;
    }

    protected _nextTimeout(_now : number|null = null) {
        const now = _now === null ? new Date() : new Date(_now); // used for testing

        let target = new Date(this._dates[0]);
        for (let i = 1; i < this._dates.length; i++) {
            const temp = new Date(this._dates[i]);

            if (temp.getTime() > now.getTime() && (temp.getTime() < target.getTime() || now.getTime() > target.getTime()))
                target = temp;
        }
        const interval = target.getTime() - now.getTime();

        // prevent overflow, ignore very large timers
        if (interval < 2**31-1 && interval > 0)
            return interval;

        this.end();
        return 0;
    }
}

export {
    Timer,
    AtTimer,
    OnTimer
};
