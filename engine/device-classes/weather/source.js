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
var cnt = 0;
var url = 'http://api.yr.no/weatherapi/locationforecast/1.9/?lat=37.25;lon=122.8';

module.exports = new Tp.ChannelClass({
    Name: 'WeatherChannel',
    RequiredCapabilities: ['channel-state'],

    _init: function(engine, state, device) {
        this.parent();

        cnt++;
        console.log('Created Weather channel #' + cnt);

        this._timeout = -1;
        this._state = state;
    },

    _onTick: function() {
        return Q.nfcall(httpGetAsync, url).then(function(response) {
            return Q.nfcall(parseString, response);
        }).then(function(result) {
            var temp = result.weatherdata['product'][0].time[0];
            var time = new Date(temp.$.to);
            var temperature = temp.location[0].temperature[0].$.value;
            var humidity = temp.location[0].humidity[0].$.value;
            var event = [time, temperature, humidity];

            channelInstance.emitEvent(event);
        }, function(error) {
            console.log('Error reading from yr.no server: ' + error.message);
        });
    },

    _doOpen: function() {
        var channelInstance = this;
        this._timeout = setInterval(function() {
            this._onTick().done();
        }.bind(this), 5000);
        return this._onTick();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = -1;
        return Q();
    }
});

function httpGetAsync(url, auth, callback) {
    var options = Url.parse(url);
    var req = http.get(options, function(res) {
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            data += chunk;
        });
        res.on('end', function() {
            callback(null, data);
        });
    });
    req.on('error', function(err) {
        callback(err);
    });
}
