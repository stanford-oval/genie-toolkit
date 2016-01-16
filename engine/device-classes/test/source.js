// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const Tp = require('thingpedia');

var cnt = 0;

module.exports = new Tp.ChannelClass({
    Name: 'TestChannel',

    _init: function() {
        this.parent();

        cnt++;
        console.log('Created Test channel #' + cnt);

        this._timeout = null;
    },

    _doOpen: function() {
        setTimeout(function() {
            this.emitEvent([42]);
        }.bind(this), 0);
        this._timeout = setInterval(function() {
            this.emitEvent([42 + Math.floor(Math.random() * 42)]);
        }.bind(this), 1000);
        return Q();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = null;
        return Q();
    }
});
