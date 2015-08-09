// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var Q = require('q');

var Engine = require('./engine');
var Frontend = require('./frontend');

function main() {
    global.platform = require('./platform');

    var engine = new Engine();
    var frontend = new Frontend();
    Q.all([engine.start(), frontend.start()]).then(function() {
        return engine.run().finally(function() {
            return Q.all([engine.stop(), frontend.stop()]);
        });
    }).done();
}

main();
