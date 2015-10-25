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

const BaseChannel = require('../../base_channel');

const URL_TEMPLATE = 'https://us.data.bodytrace.com/1/device/%s/datavalues?names=batteryVoltage,signalStrength,values/weight,values/unit';
const POLL_INTERVAL = 30000; // 30s

var cnt = 0;

const ScaleChannel = new lang.Class({
    Name: 'ScaleChannel',
    Extends: BaseChannel,

    _init: function(engine, state, device) {
        this.parent();

        cnt++;
        console.log('Created Scale channel #' + cnt);

        this._url = URL_TEMPLATE.format(device.serial);
        this._auth = "Basic " + (new Buffer(device.username + ':' + device.password)).toString('base64');
        this._timeout = -1;
        this._state = state;
    },

    _onTick: function() {
        var channelInstance = this;
        var url = this._url;
        var auth = this._auth;
        var state = this._state;

        return Q.nfcall(httpGetAsync, url, auth).then(function(response) {
            function makeEvent(time, data) {
                var date = new Date(0); // The 0 there is the key, which sets the date to the epoch
                date.setUTCSeconds(time/1000);

                // weight is in grams, convert to kg, which the base unit
                // AppExecutor wants
                var weight = (data[time].values.weight)/1000;
                var event = { ts: date, weight: weight };
                return event;
            }

            var weight, keys, utcMilliSeconds;
            try {
                weight = JSON.parse(response);
                keys = Object.keys(weight);
                utcMilliSeconds = keys[0];
            } catch(e) {
                console.log('Error parsing BodyTrace server response: ' + e.message);
                console.log('Full response was');
                console.log(response);
                return;
            }

            var lastRead = state.get('last-read');
            if (lastRead === undefined)
                lastRead = 0;
            if (utcMilliSeconds <= lastRead) {
                if (channelInstance.event === null) {
                    // cold plug channel, but don't emit an event
                    channelInstance.setCurrentEvent(makeEvent(utcMilliSeconds, weight));
                    channelInstance.nextTick();
                } else {
                    channelInstance.nextTick();
                }
            } else {
                state.set('last-read', utcMilliSeconds);

                // find the last reading that we knew about
                for (var i = 0; i < keys.length; i++) {
                    if (keys[i] <= lastRead) {
                        if (channelInstance.event === null)
                            channelInstance.setCurrentEvent(makeEvent(keys[i], weight));
                        break;
                    }
                }

                // then emit an event for each new data point
                // (note we reuse i from the previous loop!)
                for (; i >= 0; i--)
                    channelInstance.emitEvent(makeEvent(keys[i], weight));
            }
        }, function(error) {
            console.log('Error reading from BodyTrace server: ' + error.message);
        });
    },

    _doOpen: function() {
        this._timeout = setInterval(function() {
            this._onTick().done();
        }.bind(this), POLL_INTERVAL);
        return this._onTick();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = -1;
        return Q();
    }
});

function createChannel(engine, state, device) {
    return new ScaleChannel(engine, state, device);
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
module.exports.requiredCapabilities = ['channel-state'];
