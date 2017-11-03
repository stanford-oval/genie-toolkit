// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

// A reference to an object that automatically disappears after some time

module.exports = class TimedReference {
    constructor(maxAge, autoRelease, releasefn) {
        this._cached = null;
        this._age = 0;
        this._timeout = null;
        this._maxAge = maxAge;
        this._releasable = autoRelease;
        this._autoRelease = autoRelease;
        this._releasefn = releasefn || null;
    }

    acquire(ifabsent) {
        if (!this._autoRelease)
            this._releasable = false;
        if (this._cached) {
            this._age = Date.now();
            return Q(this._cached);
        }

        return this._cached = Q(ifabsent()).then((result) => {
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

    _tryClear() {
        if (!this._cached)
            return;

        Q(this._cached).then((cached) => {
            this._timeout = null;
            if (!this._releasable)
                return;

            let age = Date.now() - this._age;
            if (age < this._maxAge - 100) {
                this._timeout = setTimeout(() => {
                    this._tryClear();
                }, this._maxAge - this._age);
            } else {
                this._timeout = null;
                this._age = 0;
                this._cached = null;

                if (this._releasefn)
                    Q(this._releasefn(cached)).catch((error) => console.error(error));
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

        Q(this._cached).then((cached) => {
            this._timeout = null;
            this._age = 0;
            this._cached = null;

            if (this._releasefn)
                Q(this._releasefn(cached)).catch((error) => console.error(error));
        });
    }
}



