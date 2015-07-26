// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var Engine = require('../../engine/engine.js');
var Frontend = require('./frontend.js');

function main() {
    var engine = new Engine();
    engine.start();

    var frontend = new Frontend();
    frontend.start();

    engine.run();

    engine.stop();
    frontend.stop();
}

main();
