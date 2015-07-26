// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

function Engine() {
    this._init.apply(this, arguments);
}

Engine.prototype._init = function _init() {
    // constructor
}

Engine.prototype.start = function start() {
    console.log('Engine started');
}

Engine.prototype.run = function run() {
    console.log('Engine running');
}

Engine.prototype.stop = function stop() {
    console.log('Engine stopped');
}

module.exports = Engine;
