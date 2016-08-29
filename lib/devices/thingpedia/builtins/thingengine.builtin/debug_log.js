// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'LoggerChannel',

    _init(engine, device) {
        this.parent();
        this.engine = engine;

        this._inner = null;
    },

    _doOpen() {
        return this.engine.channels.getNamedPipe('thingengine-system-logger', 'w').then((ch) => {
            this._inner = ch;
        });
    },

    _doClose() {
        var ch = this._inner;
        this._inner = null;
        return ch.close();
    },

    sendEvent(event) {
        return this._inner.sendEvent(event);
    }
});
