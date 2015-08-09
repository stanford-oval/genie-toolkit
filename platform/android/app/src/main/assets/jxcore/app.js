// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const fs = require('fs');

const Engine = require('./engine');

function runEngine(eventfd) {
    global.platform = require('./platform');

    platform.init().then(function() {
        console.log('Android platform initialized');
        console.log('Creating engine...');

        var engine = new Engine();

        var flagPipe = fs.createReadStream('', {fd: eventfd, flag:'r',
                                                autoClose: false});
        flagPipe.on('readable', function() {
            engine.stop();
        });

        return engine.open().then(function() {
            return engine.run().finally(function() {
                return engine.close();
            });
        });
    }).catch(function(error) {
        console.log('Uncaught exception: ' + error);
    }).finally(function() {
        console.log('Cleaning up');
        platform.exit();
    }).done();
}

JXMobile('runEngine').registerToNative(runEngine);


