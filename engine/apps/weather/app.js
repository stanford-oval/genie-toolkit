// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Weather Channel
//
// Copyright 2015 Jiaqi Xue<jiaqixue@stanford.edu>
//


const lang = require('lang');
const Q = require('q');

const BaseApp = require('../../base_app');

const WeatherApp = new lang.Class({
    Name: 'WeatherApp',
    Extends: BaseApp,

    _init: function(engine, state) {
        this.parent(engine, state);
        this._interval = -1;

        this._weatherChannel = null;
        this._pipe = null;
    },

    _onChannelEvent: function(event) {
        console.log('Weather App received an event on Weather Channel: ' + JSON.stringify(event));

// Do something :)
    },

    start: function() {
        console.log('Weather App starting');

        return Q.all([this.engine.channels.getChannel('weather'),
                      this.engine.channels.getNamedPipe('weather-pipe', 'r')])
            .spread(function(channel, pipe) {
                this._weatherChannel = channel;
                this._pipe = pipe;
                channel.on('event', this._onChannelEvent.bind(this));
                console.log('Weather app obtained a weather Channel and a Pipe');
            }.bind(this));
    },

    stop: function() {
        console.log('Weather App stopping');
        return Q.all([this._weatherChannel != null ? this._weatherChannel.close() : Q(),
                      this._pipe != null ? this._pipe.close() : Q()]);
    }
});

function createApp(engine, serializedApp) {
    return new WeatherApp(engine);
}

module.exports.createApp = createApp;
