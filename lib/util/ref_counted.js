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

const Q = require('q');
const events = require('events');

module.exports = class RefCounted extends events.EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(0);

        this._useCount = 0;
        this._openPromise = null;
        this._closePromise = null;
    }

    _doOpen() {
        return Q();
    }

    _doClose() {
        return Q();
    }

    open() {
        // if closing, wait to fully close then reopen
        if (this._closePromise) {
            return this._closePromise.then(function() {
                return this.open();
            }.bind(this));
        }

        this._useCount++;
        if (this._useCount == 1) { // first open
            if (this._openPromise)
                throw new Error('bookkeeping error');
            return this._openPromise = Q(this._doOpen()).finally(function() {
                this._openPromise = null;
            }.bind(this));
        } else if (this._openPromise) { // opening
            return this._openPromise;
        } else { // opened
            return Q();
        }
    }

    close() {
        // if opening, wait to fully open then close
        if (this._openPromise) {
            return this._openPromise.then(function() {
                return this.close();
            }.bind(this));
        }

        this._useCount--;
        if (this._useCount < 0)
            throw new Error('invalid close');
        if (this._useCount == 0) { // last close
            if (this._closePromise)
                throw new Error('bookkeeping error');
            return this._closePromise = Q(this._doClose()).finally(function() {
                this._closePromise = null;
            }.bind(this));
        } else if (this._closePromise) { // closing
            return this._closePromise;
        } else { // closed
            return Q();
        }
    }
}
