// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var Q = require('q');

var db = require('./engine/db');
var Engine = require('./engine');
var Frontend = require('./frontend');

function main() {
    global.platform = require('./platform');

    platform.init().then(function() {
        var apps = new db.FileAppDatabase(platform.getWritableDir() + '/apps.db');
        var devices = new db.FileDeviceDatabase(platform.getWritableDir() + '/devices.db');
        var engine = new Engine(apps, devices);
        var frontend = new Frontend();

        var earlyStop = false;
        var engineRunning = false;
        process.on('SIGINT', function() {
            if (engineRunning)
                engine.stop();
            else
                earlyStop = true;
        });

        return Q.all([engine.open(), frontend.open()]).then(function() {
            engineRunning = true;
            if (earlyStop)
                return;
            return engine.run().finally(function() {
                return Q.all([engine.close(), frontend.close()]);
            });
        });
    }).catch(function(error) {
        console.log('Uncaught exception: ' + error);
    }).finally(function () {
        console.log('Cleaning up');
        platform.exit();
    }).done();
}

main();
