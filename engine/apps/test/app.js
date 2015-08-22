// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseApp = require('../../base_app');

const TestApp = new lang.Class({
    Name: 'TestApp',
    Extends: BaseApp,

    _init: function(engine, state) {
        this.parent(engine, state);
        this._interval = -1;

        this._testChannel = null;
        this._pipe = null;
    },

    _onChannelEvent: function(event) {
        console.log('Test App received an event on Test Channel: ' + JSON.stringify(event));

        if (platform.type === 'server') // send it back to the phone
            this._testChannel.sendEvent({number:event.number * 2});

        this._pipe.sendEvent({number:event.number * 3});
    },

    start: function() {
        console.log('Test App starting');

        return Q.all([this.engine.channels.getChannel('test'),
                      this.engine.channels.getNamedPipe('test-pipe', 'w')])
            .spread(function(channel, pipe) {
                this._testChannel = channel;
                this._pipe = pipe;
                channel.on('event', this._onChannelEvent.bind(this));
                console.log('Test App obtained a Test Channel and a Test Pipe');
            }.bind(this));
    },

    stop: function() {
        console.log('Test App stopping');
        return Q.all([this._testChannel != null ? this._testChannel.close() : Q(),
                      this._pipe != null ? this._pipe.close() : Q()]);
    }
});

function createApp(engine, serializedApp) {
    return new TestApp(engine, serializedApp);
}

module.exports.createApp = createApp;
