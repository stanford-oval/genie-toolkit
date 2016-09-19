// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

module.exports = class Logger {
    constructor(pipes) {
        this._pipes = pipes;

        this._inner = null;
        this._listener = this._onEvent.bind(this);
    }

    _onEvent(data) {
        var message = data[0];
        console.log("LoggingChannel:", message);
    }

    start() {
        this._inner = this._pipes.getLocalSourceNamedPipe('thingengine-system-logger', 'r');
        this._inner.on('data', this._listener);
        return this._inner.open();
    }

    stop() {
        this._inner.removeListener('data', this._listener);
        return this._inner.close();
    }
}
