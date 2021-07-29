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
 */
export default class TimedReference<T> {
    private _cached : T|Promise<T>|null;
    private _age : number;
    private _maxAge : number;
    private _timeout : NodeJS.Timeout|null;
    private _releasable : boolean;
    private _autoRelease : boolean;
    private _releasefn : ((x : T) => Promise<void>)|null;

    constructor(maxAge : number, autoRelease : boolean, releasefn ?: (x : T) => Promise<void>) {
        this._cached = null;
        this._age = 0;
        this._timeout = null;
        this._maxAge = maxAge;
        this._releasable = autoRelease;
        this._autoRelease = autoRelease;
        this._releasefn = releasefn || null;
    }

    acquire(ifabsent : () => T|Promise<T>) : Promise<T> {
        if (!this._autoRelease)
            this._releasable = false;
        if (this._cached) {
            this._age = Date.now();
            return Promise.resolve(this._cached);
        }

        return this._cached = Promise.resolve(ifabsent()).then((result) => {
            this._age = Date.now();
            this._cached = result;
            if (this._autoRelease && !this._timeout) {
                this._timeout = setTimeout(() => {
                    this._tryClear();
                }, this._maxAge);
            }
            return result;
        });
    }

    private _tryClear() {
        if (!this._cached)
            return;

        Promise.resolve(this._cached).then((cached) => {
            this._timeout = null;
            if (!this._releasable)
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

                if (this._releasefn)
                    Promise.resolve(this._releasefn(cached)).catch((error) => console.error(error));
            }
        });
    }

    release() {
        this._releasable = true;
        if (!this._timeout) {
            this._timeout = setTimeout(() => {
                this._tryClear();
            }, this._maxAge);
        }
    }

    releaseNow() {
        if (this._timeout)
            clearTimeout(this._timeout);

        if (!this._cached)
            return;

        Promise.resolve(this._cached).then((cached) => {
            this._timeout = null;
            this._age = 0;
            this._cached = null;

            if (this._releasefn)
                Promise.resolve(this._releasefn(cached)).catch((error) => console.error(error));
        });
    }
}
