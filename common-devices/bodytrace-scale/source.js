// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Jiaqi Xue <jiaqixue@stanford.edu>
//

const Tp = require('thingpedia');

const URL_TEMPLATE = 'https://us.data.bodytrace.com/1/device/%s/datavalues?names=batteryVoltage,signalStrength,values/weight,values/unit';
const POLL_INTERVAL = 3600 * 1000; // 1h

module.exports = new Tp.ChannelClass({
    Name: 'ScaleChannel',
    Extends: Tp.HttpPollingTrigger,
    RequiredCapabilities: ['channel-state'],
    interval: POLL_INTERVAL,

    _init: function(engine, state, device) {
        this.parent();

        this.url = URL_TEMPLATE.format(device.serial);
        this.auth = "Basic " + (new Buffer(device.username + ':' + device.password)).toString('base64');
        this._state = state;
    },

    _onResponse: function(response) {
        var state = this._state;

        function makeEvent(time, data) {
            // weight is in grams, convert to kg, which the base unit
            // AppExecutor wants
            var weight = (data[time].values.weight)/1000;
            var event = [time, weight];
            return event;
        }

        var weight, keys, utcMilliSeconds;
        try {
            weight = JSON.parse(response);
            keys = Object.keys(weight);
            utcMilliSeconds = parseInt(keys[0]);
        } catch(e) {
            console.log('Error parsing BodyTrace server response: ' + e.message);
            console.log('Full response was');
            console.log(response);
            return;
        }

        var lastRead = state.get('last-read');
        if (lastRead === undefined) {
            lastRead = utcMilliSeconds;
            state.set('last-read', utcMilliSeconds);
        }
        if (utcMilliSeconds <= lastRead) {
            if (this.event === null) {
                this.emitEvent(makeEvent(utcMilliSeconds, weight));
            } else {
                return;
            }
        } else {
            state.set('last-read', utcMilliSeconds);

            // find the last reading that we knew about
            for (var i = 0; i < keys.length; i++) {
                if (parseInt(keys[i]) <= lastRead)
                    break;
            }

            // then emit an event for each new data point
            // (note we reuse i from the previous loop!)
            for (; i >= 0; i--)
                this.emitEvent(makeEvent(parseInt(keys[i]), weight));
        }
    },
});


