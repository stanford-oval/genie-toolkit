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
    constructor(channels) {
        this._channels = channels

        this._inner = null;
        this._listener = this._onEvent.bind(this);
    }

    _onEvent(data) {
        var message = data[0];
        console.log("LoggingChannel:", message);
    }

    start() {
        return this._channels.getNamedPipe('thingengine-system-logger', 'r')
            .then(function(ch) {
                this._inner = ch;
                this._inner.on('data', this._listener);
            }.bind(this));
    }

    stop() {
        this._inner.removeListener('data', this._listener);
        return this._inner.close();
    }
}
