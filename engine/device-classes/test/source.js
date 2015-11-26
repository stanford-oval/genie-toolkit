// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseChannel = require('../../base_channel');

var cnt = 0;

const TestChannel = new lang.Class({
    Name: 'TestChannel',
    Extends: BaseChannel,

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

function createChannel() {
    return new TestChannel();
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
