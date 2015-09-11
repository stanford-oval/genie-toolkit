// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

const BaseChannel = require('../base_channel');


var parseString = require('xml2js').parseString;
var cnt = 0;
var url = 'http://api.yr.no/weatherapi/locationforecast/1.9/?lat=37.25;lon=122.8';
const WeatherChannel = new lang.Class({
    Name: 'WeatherChannel',
    Extends: BaseChannel,

    _init: function() {
        this.parent();

        cnt++;
        console.log('Created Weather channel #' + cnt);

        this._timeout = -1;
    },

    get isSource() {
        return true;
    },
    get isSink() {
        return false;
    },

    _doOpen: function() {
        var channelInstance = this;
        this._timeout = setInterval(function() {
            httpGetAsync(url , function(response) {
                parseString(response, function( err, result) {
                //console.log(JSON.stringify(result.weatherdata['product'][0].time[0], null, 1));
                var temp = result.weatherdata['product'][0].time[0];
                var temperature = temp.location[0].temperature[0].$.value;
                var humidity = temp.location[0].humidity[0].$.value;
                var event =  {weather: "temerature: " + temperature + ", humidity: " + humidity};
                /*
                {temperature: "",
                 humidity: "",
                 overall:"sunny/rainy/cloudy"}
                 */
                console.log("temp: " , event);
                channelInstance.emitEvent(event);
                });
            });
           
        }.bind(this), 5000);
        return Q();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = -1;
        return Q();
    }
});

function createChannel() {
    return new WeatherChannel();
}

function httpGetAsync(theUrl, callback)
{
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.onreadystatechange = function() { 
        if (xmlHttp.readyState == 4 && xmlHttp.status == 200)
            callback(xmlHttp.responseText);
    }
    xmlHttp.open("GET", theUrl, true); // true for asynchronous 
    xmlHttp.send(null);
}

module.exports.createChannel = createChannel;
