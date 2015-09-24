const Q = require('q');
const fs = require('fs');

const AppExecutor = require('../engine/app_executor');
const AppGrammar = require('../engine/app_grammar');

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
    var channels = {
        getChannel: function(id, arg) {
            if (id === 'weather') {
                console.log('Created weather channel with arg ' + arg);
                return Q(weatherChannel);
            }
        }
    };
    var engine = {
        devices: devices,
        channels: channels,
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

    app.start();
    setTimeout(function() {
        app._onData();
    }, 1000);
}

function parserTest() {
    var code = fs.readFileSync('./test/sample.apps').toString('utf8').split('====');

    code.forEach(function(code) {
        try {
            AppGrammar.parse(code);
        } catch(e) {
            console.log('Parsing failed');
            console.log(code);
            console.log(e);
        }

        try {
            // try also instantiating the app, which runs semantic analysis of it
            // we won't start the app so it will not poke the engine to get channels
            // or devices
            new AppExecutor(getMockEngine(), code, {});
        } catch(e) {
            // some of the errors here are expected, eg. the instagram example
            // as a selfie() function
            // not a biggie
            console.log('Compilation failed');
            console.log(e);
        }
    });
}

parserTest();
executorTest();

