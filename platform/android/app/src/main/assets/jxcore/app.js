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
const appdb = require('./engine/db/apps');
const Engine = require('./engine');
const Tier = require('./engine/tier_manager').Tier;

function runEngine() {
    global.platform = require('./platform');

    platform.init().then(function() {
        console.log('Android platform initialized');
        console.log('Creating engine...');

        var apps = new appdb.FileAppDatabase(platform.getWritableDir() + '/apps.db');
        var engine = new Engine(apps);

        var engineRunning = false;
        var earlyStop = false;
        var controlChannel = new control.ControlChannel({
            // handle control methods here...

            foo: function(int) {
                console.log('Foo called on control channel with value ' + int);
                return int;
            },

            stop: function() {
                if (engineRunning)
                    engine.stop();
                else
                    earlyStop = true;
                controlChannel.close();
            },

            setCloudId: function(cloudId, authToken) {
                var prefs = platform.getSharedPreferences();
                var oldCloudId = prefs.get('cloud-id');
                if (oldCloudId !== undefined && cloudId !== oldCloudId)
                    return false;
                var oldAuthToken = prefs.get('auth-token');
                if (oldAuthToken !== undefined && authToken !== oldAuthToken)
                    return false;
                if (oldCloudId === cloudId && authToken === oldAuthToken)
                    return true;
                prefs.set('cloud-id', cloudId);
                prefs.set('auth-token', authToken);
                engine._tiers._reopenOne(Tier.CLOUD);
                return true;
            },

            // For testing only!
            injectDevice: function(device) {
                console.log('Injecting device ' + JSON.stringify(device, 1));
                engine.devices._loadOneDevice(device, true).done();
            }
        });

        return controlChannel.open().then(function() {
            // signal early to stop the engine
            JXMobile('controlReady').callNative();

            return engine.open();
        }).then(function() {
            engineRunning = true;
            if (earlyStop)
                return engine.close();
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

