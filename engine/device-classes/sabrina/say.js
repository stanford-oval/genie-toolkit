// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'SabrinaSayChannel',

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;

        this._inner = null;
    },

    sendEvent: function(event) {
        this._inner.sendEvent(event);
    },

    _doOpen: function() {
        return this.engine.channels.getNamedPipe('sabrina-outgoing-messages', 'w')
            .then(function(ch) {
                this._inner = ch;
            }.bind(this));
    },

    _doClose: function() {
        return this._inner.close();
    },
});
