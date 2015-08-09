// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

// Server platform

const Q = require('q');
const os = require('os');

module.exports = {
    init: function() {
        return Q(true);
    },

    getRoot: function() {
        return process.cwd();
    },

    getWritableDir: function() {
        return process.cwd();
    },

    getTmpDir: function() {
        return os.tmpdir() + '/thingengine';
    }
};
