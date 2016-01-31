const Q = require('q');
const fs = require('fs');

require('../engine/polyfill');

const ObjectSet = require('../engine/object_set');
const AppExecutor = require('../engine/app_executor');

function getMockEngine() {
    var weatherChannel = {
        isSink: false,
        isSource: true,
        uniqueId: 'weather-source-weather1',
        event: {
            temperature: 15 // must be less than 21.1
        },
        on: function() {
            console.log('subscribing to weather channel ' + this.uniqueId);
        },
        removeListener: function() { }
    };
    var locationChannel = function(id, name) {
        return {
            isSink: false,
            isSource: true,
            uniqueId: id,
            event: {
                name: name,
                location: {x: 3100, y: 0} // distance from 0,0 must be > 3000
            },
            on: function() {
                console.log('subscribing to location channel ' + this.uniqueId);
            },
        };
    };
    var personDevice = function(id, name) {
        return {
            uniqueId: id,
            hasKind: function(k) { return k === 'location'; },
            hasTag: function(t) { return t === 'person'; },
            getChannel: function(c) {
                if (c !== 'source') throw new Error();
                return Q(locationChannel('location-source-' + this.uniqueId, name));
            },
            name: name
        };
    };

    var lightbulbChannel = function(id) {
        return {
            isSink: true,
            isSource: false,
            uniqueId: id,
            sendEvent: function(event) {
                console.log('writing to lightbulb ' + this.uniqueId + ' ' +
                            JSON.stringify(event));
            },
        };
    };
    var lightbulbDevice = function(id, livingroom) {
        return {
            uniqueId: id,
            hasKind: function(k) { return k === 'light'; },
            hasTag: function(t) { return t === 'livingroom' && livingroom; },
            getChannel: function(c) {
                if (c !== 'sink') throw new Error();
                return Q(lightbulbChannel('lightbulb-sink-' + this.uniqueId));
            }
        };
    };

    var smsChannel = function(id) {
        return {
            isSink: true,
            isSource: false,
            uniqueId: id,
            sendEvent: function(event) {
                console.log('writing to sms ' + this.uniqueId + ' ' +
                            JSON.stringify(event));
            },
        };
    };
    var smsDevice = {
        uniqueId: 'sms1',
        hasKind: function(k) { return k === 'sms'; },
        hasTag: function(t) { return false },
        getChannel: function(c) {
            if (c !== 'send') throw new Error();
            return Q(smsChannel('sms-send-' + this.uniqueId));
        }
    };

    var homeDevice = {
        uniqueId: 'thingengine-own-server',
        hasKind: function() { return false; },
        hasTag: function() { return false; },
        getChannel: function() {
            throw new Error();
        },
        location: {x:0, y:0}
    };

    var devices = {
        _all: [personDevice('person-jim', 'Jim'),
               personDevice('person-joe', 'Joe'),
               personDevice('person-mark', 'Mark'),
               lightbulbDevice('light1', true), lightbulbDevice('light2', true),
               lightbulbDevice('light3', false), smsDevice, homeDevice],

        getContext: function(ctx) {
            if (ctx !== 'me')
                throw new Error('Invalid context ' + ctx);
            var set = new ObjectSet.Simple(false);
            set.addMany(this.getAllDevices());
            set.freeze();
            return set;
        },

        getAllDevices: function() {
            return this._all;
        },
        getDevice: function(id) {
            for (var i = 0; i < this._all.length; i++) {
                var d = this._all[i];
                if (d.uniqueId === id)
                    return d;
            }
            throw new Error('Unknown device ' + id);
        },
        on: function() {},
        removeListener: function() {}
    };
    var engine = {
        devices: devices,
    };

    return engine;
}

function executorTest() {
    var code = fs.readFileSync('./test/test.app').toString('utf8');
    var app = new AppExecutor(getMockEngine(), code, {'someone': 'Mike'});

    app.inputs.forEach(function(input) {
        console.log('input', input);
    });
    app.outputs.forEach(function(output) {
        console.log('output', output);
    });
    /*
    app.start();
    setTimeout(function() {
        app._onData();
    }, 1000);*/
}
executorTest();

