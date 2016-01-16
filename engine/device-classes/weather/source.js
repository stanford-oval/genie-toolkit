// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const http = require('http');
const Tp = require('thingpedia');

var parseString = require('xml2js').parseString;
var url = 'http://api.yr.no/weatherapi/locationforecast/1.9/?lat=37.25;lon=122.8';

module.exports = new Tp.ChannelClass({
    Name: 'WeatherChannel',
    Extends: Tp.WeatherChannel,
    RequiredCapabilities: [],
    interval: 3600 * 1000 * 3,

    _init: function(engine, state, device) {
        this.parent();

        this.url = url;
    },

    _onResponse: function(response) {
        return Q.nfcall(parseString, response).then(function(result) {
            var temp = result.weatherdata['product'][0].time[0];
            var time = new Date(temp.$.to);
            var temperature = temp.location[0].temperature[0].$.value;
            var humidity = temp.location[0].humidity[0].$.value;
            var event = [time, temperature, humidity];

            this.emitEvent(event);
        }.bind(this));
    }
});
