// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const BaseChannel = require('../base_channel');

var cnt = 0;
var url = 'http://api.yr.no/weatherapi/locationforecast/1.9/?lat=37.25;lon=122.8';

const WeatherChannel = new lang.Class({
    Name: 'WeatherChannel',
    Extends: BaseChannel,

    _init: function() {
        this.parent();

        cnt++;
        console.log('Created Test Weather channel #' + cnt);

        this._timeout = -1;
    },

    get isSource() {
        return true;
    },
    get isSink() {
        return true;
    },

    // For testing only
    get isSupported() {
        return platform.type === 'android';
    },
    _doOpen: function() {
        // emit weather
        //weather API not found yet
        setTimeout(function() {
            this.emitEvent({weather:42});
        }.bind(this), 0);
        this._timeout = setInterval(function() {
            httpGetAsync(url , function(response) {
                //Am i doing this right?
              
                var event = {weather:response};
                this.emitEvent(event);
            });
           
        }.bind(this), 60000);
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
