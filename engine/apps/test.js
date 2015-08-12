// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseApp = require('../base_app');

const TestApp = new lang.Class({
    Name: 'TestApp',
    Extends: BaseApp,

    _init: function() {
        this.parent();
        this._interval = -1;
    },

    serialize: function() {
        return { kind: 'test' };
    },

    _onEvent: function() {
        console.log('Test App waking up');
    },

    start: function() {
        console.log('Test App starting');
        this._interval = setInterval(this._onEvent.bind(this), 5000);
        this.isRunning = true;
        return Q(true);
    },

    stop: function() {
        console.log('Test App stopping');
        clearInterval(this._interval);
        this._interval = -1;
        this.isRunning = false;
        return Q(true);
    }
});

function createApp(engine, serializedApp) {
    return new TestApp();
}

module.exports.createApp = createApp;
