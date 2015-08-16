// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const db = require('./engine/db');
const Engine = require('./engine');

function runEngine() {
    global.platform = require('./platform');

    platform.init().then(function() {
        var apps = new db.FileAppDatabase(platform.getWritableDir() + '/apps.db');
        var devices = new db.FileDeviceDatabase(platform.getWritableDir() + '/devices.db');
        var engine = new Engine(apps, devices);

        var earlyStop = false;
        var engineRunning = false;
        function handleSignal() {
            if (engineRunning)
                engine.stop();
            else
                earlyStop = true;
        }
        process.on('SIGINT', handleSignal);
        process.on('SIGTERM', handleSignal);

        return engine.open().then(function() {
            engineRunning = true;
            if (earlyStop)
                return;
            return engine.run().finally(function() {
                return engine.close();
            });
        });
    }).then(function () {
        console.log('Cleaning up');
        platform.exit();
    }).done();
}

runEngine();
