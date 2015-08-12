// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

// Server platform

const Q = require('q');
const fs = require('fs');
const os = require('os');

module.exports = {
    // Initialize the platform code
    // Will be called before instantiating the engine
    init: function() {
        try {
            fs.mkdirSync(process.cwd() + '/cache');
        } catch(e) {
            if (e.code != 'EEXIST')
                throw e;
        }
        return Q(true);
    },

    // If downloading code from the thingpedia server is allowed on
    // this platform
    canDownloadCode: true,

    // Check if this platform has the required capability
    // (eg. long running, big storage, reliable connectivity, server
    // connectivity, stable IP, local device discovery, bluetooth, etc.)
    //
    // Which capabilities are available affects which apps are allowed to run
    hasCapability: function(cap) {
        return false;
    },

    // Get the root of the application
    // (In android, this is the virtual root of the APK)
    getRoot: function() {
        return process.cwd();
    },

    // Get a directory that is guaranteed to be writable
    // (in the private data space for Android)
    getWritableDir: function() {
        return process.cwd();
    },

    // Get a directory good for long term caching of code
    // and metadata
    getCacheDir: function() {
        return process.cwd() + '/cache';
    },

    // Get a temporary directory
    // Also guaranteed to be writable, but not guaranteed
    // to persist across reboots or for long times
    // (ie, it could be periodically cleaned by the system)
    getTmpDir: function() {
        return os.tmpdir() + '/thingengine';
    },

    // Stop the main loop and exit
    // (In Android, this only stops the node.js thread)
    // This function should be called by the platform integration
    // code, after stopping the engine
    exit: function() {
        return process.exit();
    }
};
