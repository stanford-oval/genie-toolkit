// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const Q = require('q');

module.exports = new Tp.ChannelClass({
    Name: 'SabrinaOnPictureChannel',

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;

        this._inner = null;
        this._listener = this._onMessage.bind(this);
    },

    _onMessage: function(url) {
        this.emitEvent([url]);
    },

    _doOpen: function() {
        this.engine.assistant.on('picture', this._listener);
        return Q();
    },

    _doClose: function() {
        this.engine.assistant.removeListener('picture', this._listener);
        return Q();
    },
});
