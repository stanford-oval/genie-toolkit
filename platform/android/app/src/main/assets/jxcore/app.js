// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

console.log('ThingEngine-Android starting up...');

const Q = require('q');
const fs = require('fs');

const control = require('./control');
const Engine = require('./engine');

function runEngine() {
    global.platform = require('./platform');

    platform.init().then(function() {
        console.log('Android platform initialized');
        console.log('Creating engine...');

        var engine = new Engine();

        var controlChannel = new control.ControlChannel({
            // handle control methods here...

            foo: function(int) {
                console.log('Foo called on control channel with value ' + int);
                return int;
            },

            stop: function() {
                engine.stop();
                controlChannel.close();
            }
        });
        return controlChannel.open().then(function() {
            return engine.open();
        }).then(function() {
            JXMobile('controlReady').callNative();
            return engine.run().finally(function() {
                return engine.close();
            });
        });
    }).catch(function(error) {
        console.log('Uncaught exception: ' + error.message);
        console.log(error.stack);
    }).finally(function() {
        console.log('Cleaning up');
        platform.exit();
    }).done();
}

console.log('Registering to JXMobile');
JXMobile('runEngine').registerToNative(runEngine);

