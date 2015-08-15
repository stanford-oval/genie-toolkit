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

    _init: function(engine) {
        this.parent(engine);
        this._interval = -1;

        this._testChannel = null;
    },

    serialize: function() {
        return { kind: 'test' };
    },

    _onEvent: function(event) {
        console.log('Test App received an event on Test Channel: ' + event);

        if (platform.type === 'server') // send it back to the phone
            this._testChannel.sendEvent(event * 2);
    },

    start: function() {
        console.log('Test App starting');

        return this.engine.channels.getChannel('test').then(function(channel) {
            this._testChannel = channel;
            channel.on('event', this._onEvent.bind(this));
            return channel.open().then(function() {
                console.log('Test App obtained a Test Channel');
            });
        }.bind(this));
    },

    stop: function() {
        console.log('Test App stopping');
        if (this._testChannel != null)
            return this._testChannel.close();
        else
            return Q();
    }
});

function createApp(engine, serializedApp) {
    return new TestApp(engine);
}

module.exports.createApp = createApp;
