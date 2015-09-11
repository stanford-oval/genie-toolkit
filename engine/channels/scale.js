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
var url = 'https://us.data.bodytrace.com/1/device/013950003129682/datavalues?names=batteryVoltage,signalStrength,values/weight,values/unit';
var encode = "bW9iaXNvY2lhbC5kZXZlbEBnbWFpbC5jb206bzEyOHJRVTlxdTJvOHV1dGd5aDNv";
const ScaleChannel = new lang.Class({
    Name: 'ScaleChannel',
    Extends: BaseChannel,

    _init: function() {
        this.parent();

        cnt++;
        console.log('Created Scale channel #' + cnt);

        this._timeout = -1;
    },

    get isSource() {
        return true;
    },
    get isSink() {
        return false;
    },

    // For testing only
    get isSupported() {
        return platform.type === 'android';
    },

    _doOpen: function() {
        var channelInstance = this;
        this._timeout = setInterval(function() {
            httpGetAsync(url , function(response) {

                var weight = JSON.parse(response);
                var utcSeconds = Object.keys(weight)[0];
                var weight = (weight[utcSeconds].values.weight)/1000;
                var date = new Date(0); // The 0 there is the key, which sets the date to the epoch
                date.setUTCSeconds(utcSeconds);
                var event =  {measurement: "time measured: " + date + ", weight: " + weight + " Kg"};
                channelInstance.emitEvent(event);
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
    return new ScaleChannel();
}

function httpGetAsync(theUrl, callback)
{
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.onreadystatechange = function() { 
        if (xmlHttp.readyState == 4 && xmlHttp.status == 200)
            callback(xmlHttp.responseText);
    }
    xmlHttp.open("GET", theUrl, true); // true for asynchronous 
    xmlHttp.setRequestHeader("Authorization", "Basic " + encode); 
    xmlHttp.send(null);
}

module.exports.createChannel = createChannel;
