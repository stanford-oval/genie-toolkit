// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

var cnt = 0;

module.exports = new Tp.ChannelClass({
    Name: 'TestChannel',
    Extends: Tp.PollingTrigger,
    interval: 5000,

    _init: function() {
        this.parent();

        cnt++;
        console.log('Created Test channel #' + cnt);
    },

    _onTick: function() {
        this.emitEvent([42 + Math.floor(Math.random() * 42)]);
    },

    _doOpen: function() {
        setTimeout(function() {
            this.emitEvent([42]);
        }.bind(this), 0);
        return this.parent();
    },
});
