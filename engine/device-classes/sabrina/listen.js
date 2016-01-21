// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'SabrinaListenChannel',

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;

        this._inner = null;
        this._listener = this._onEvent.bind(this);
    },

    _onEvent: function(data) {
        this.emitEvent(data);
    },

    _doOpen: function() {
        return this.engine.channels.getNamedPipe('sabrina-incoming-messages', 'r')
            .then(function(ch) {
                this._inner = ch;
                this._inner.on('data', this._listener);
            }.bind(this));
    },

    _doClose: function() {
        this._inner.removeListener('data', this._listener);
        return this._inner.close();
    },
});
