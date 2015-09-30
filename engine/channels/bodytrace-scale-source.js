// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Jiaqi Xue <jiaqixue@stanford.edu>
//

const lang = require('lang');
const Q = require('q');
const https = require('https');
const Url = require('url');

const BaseChannel = require('../base_channel');

const URL_TEMPLATE = 'https://us.data.bodytrace.com/1/device/%s/datavalues?names=batteryVoltage,signalStrength,values/weight,values/unit';

var cnt = 0;

const ScaleChannel = new lang.Class({
    Name: 'ScaleChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        cnt++;
        console.log('Created Scale channel #' + cnt);

        this._url = URL_TEMPLATE.format(device.serial);
        this._auth = "Basic " + (new Buffer(device.username + ':' + device.password)).toString('base64');
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

        var url = this._url;
        var auth = this._auth;

        this._timeout = setInterval(function() {
            httpGetAsync(url, auth, function(error, response) {
                if (error) {
                    console.log('Error reading from BodyTrace server: ' + error.message);
                    return;
                }

                try {
                    var weight = JSON.parse(response);
                    var utcSeconds = Object.keys(weight)[0];

                    // weight is in grams, convert to kg, which the base unit
                    // AppExecutor wants
                    var weight = (weight[utcSeconds].values.weight)/1000;

                    var date = new Date(0); // The 0 there is the key, which sets the date to the epoch
                    date.setUTCSeconds(utcSeconds);

                    var event = { ts: date, weight: weight };
                    channelInstance.emitEvent(event, false);
                } catch(e) {
                    console.log('Error parsing BodyTrace server response: ' + error.message);
                    return;
                }
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

function createChannel(engine, device) {
    return new ScaleChannel(engine, device);
}

function httpGetAsync(url, auth, callback) {
    var options = Url.parse(url);
    options.headers = {
        'Authorization': auth,
    };
    var req = https.get(options, function(res) {
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

module.exports.createChannel = createChannel;
