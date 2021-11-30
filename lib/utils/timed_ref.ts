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

/**
 * A reference to an object that automatically disappears after some time.
 *
 * The object has three states:
 * - in the initial, _empty_ state, the reference points to no object and
 *   the reference count is zero
 * - in the _using_ state, the reference points to some object, and the reference
 *   count is positive; the object will not be released while in this state
 * - in the _expiring_ state, the reference points to some object, but the
 *   reference count is zero; after a timeout, if still in the expiring state,
 *   the object will be released and the reference will revert to the empty state
 */
export default class TimedReference<T> {
    private readonly _maxAge : number;
    private _cached : Promise<T>|null;
    private _refCount : 0;
    private _age : number;
    private _timeout : NodeJS.Timeout|null;
    private _releasefn : ((x : T) => Promise<void>);

    /**
     * Construct a new timed reference
     *
     * @param maxAge the maximum time to be in the expiring state
     * @param releasefn a function called to release the underlying object; defaults
     *   to a no-op
     */
    constructor(maxAge : number, releasefn ?: (x : T) => Promise<void>) {
        this._maxAge = maxAge;

        this._cached = null;
        this._age = 0;
        this._timeout = null;
        this._refCount = 0;
        this._releasefn = releasefn ?? (async () => undefined);
    }

    /**
     * Acquire the object referenced by this reference.
     *
     * If `ref` is true, this function increases the reference count, so the
     * object will not be automatically released until {@link release} is called.
     * If `ref` is false, this function does not affect the reference count. If
     * the reference is currently expiring, the timeout is reset.
     *
     * @param ref
     * @param ifabsent how to compute the reference if absent; if unspecified, the
     *    object might be null if absent
     * @returns
     */
    acquire(ref : boolean, ifabsent : () => T|Promise<T>) : Promise<T>;
    acquire(ref : boolean) : Promise<T|null>;
    async acquire(ref : boolean, ifabsent ?: () => T|Promise<T>) : Promise<T|null> {
        if (ref)
            this._refCount ++;
        if (this._cached) {
            this._age = Date.now();
            if (ref && this._timeout) {
                clearTimeout(this._timeout);
                this._timeout = null;
            }
            return this._cached;
        }

        if (ifabsent) {
            return this._cached = Promise.resolve(ifabsent()).then((result) => {
                this._age = Date.now();
                if (this._refCount === 0 && !this._timeout) {
                    this._timeout = setTimeout(() => {
                        this._tryClear();
                    }, this._maxAge);
                }
                return result;
            });
        } else {
            return null;
        }
    }

    private _tryClear() {
        if (!this._cached)
            return;

        Promise.resolve(this._cached).then((cached) => {
            this._timeout = null;
            if (this._refCount > 0)
                return;

            const age = Date.now() - this._age;
            if (age < this._maxAge - 100) {
                this._timeout = setTimeout(() => {
                    this._tryClear();
                }, this._maxAge - this._age);
            } else {
                this._timeout = null;
                this._age = 0;
                this._cached = null;

                if (this._releasefn) {
                    Promise.resolve(this._releasefn(cached)).catch((error) => {
                        console.error(`Failed to release timed reference`, error);
                    });
                }
            }
        });
    }

    /**
     * Release the reference.
     *
     * If the reference count becomes zero, the reference enters the expiring state
     * and will disappear after a timeout.
     */
    release() {
        this._refCount --;
        if (this._refCount === 0 && !this._timeout) {
            this._timeout = setTimeout(() => {
                this._tryClear();
            }, this._maxAge);
        }
    }

    /**
     * Release the reference now.
     *
     * This function decreases the reference count if it is positive. If the reference
     * count is or becomes zero, it releases the object immediately.
     */
    releaseNow() {
        if (this._refCount > 0) {
            this._refCount --;
            if (this._refCount > 0)
                return;
        }

        if (this._timeout)
            clearTimeout(this._timeout);

        if (!this._cached)
            return;

        Promise.resolve(this._cached).then(async (cached) => {
            if (this._releasefn)
                await this._releasefn(cached);
        }).catch((error) => {
            console.error(`Failed to release timed reference`, error);
        });
        this._timeout = null;
        this._age = 0;
        this._cached = null;
    }
}
