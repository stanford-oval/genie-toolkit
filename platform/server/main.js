// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');

const appdb = require('./engine/db/apps');
const SQLDatabase = require('./engine/db/sqldb');
const Engine = require('./engine');
const Frontend = require('./frontend');

function main() {
    global.platform = require('./platform');

    var test = process.argv.indexOf('--test') >= 0;
    platform.init(test).then(function() {
        var apps = new appdb.FileAppDatabase(platform.getWritableDir() + '/apps.db');
        var devicesql = new SQLDatabase(platform.getWritableDir() + '/sqlite.db',
                                        'device');
        var engine = new Engine(apps, devicesql);
        var frontend = new Frontend();
        platform._setFrontend(frontend);
        frontend.setEngine(engine);

        var earlyStop = false;
        var engineRunning = false;
        function handleSignal() {
            if (engineRunning)
                engine.stop();
            else
                earlyStop = true;
        }
        //process.on('SIGINT', handleSignal);
        //process.on('SIGTERM', handleSignal);

        return Q.all([engine.open(), frontend.open()]).then(function() {
            frontend.engineLoaded();
            engineRunning = true;
            if (earlyStop)
                return;
            return engine.run().finally(function() {
                return Q.all([engine.close(), frontend.close()]);
            });
        });
    }).then(function () {
        console.log('Cleaning up');
        platform.exit();
    }).done();
}

main();
