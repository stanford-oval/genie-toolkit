// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

// Android platform

const Q = require('q');
const fs = require('fs');

const sql = require('./engine/db/sql');

var filesDir = null;
var encoding = null;

function safeMkdirSync(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code != 'EEXIST')
            throw e;
    }
}

var _prefs = null;

module.exports = {
    // Initialize the platform code
    // Will be called before instantiating the engine
    init: function() {
        return Q.nfcall(JXMobile.GetDocumentsPath).then(function(dir) {
            filesDir = dir;
            safeMkdirSync(filesDir + '/tmp');
            safeMkdirSync(filesDir + '/cache');
            return Q.nfcall(JXMobile.GetEncoding);
        }).then(function(value) {
            encoding = value;
            return Q.nfcall(JXMobile.GetSharedPreferences);
        }).then(function(prefs) {
            _prefs = prefs;

            return sql.ensureSchema(filesDir + '/sqlite.db',
                                    'schema.sql');
        });
    },

    type: 'android',

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

    // Obtain a shared preference store
    // Preferences are simple key/value store which is shared across all apps
    // but private to this instance (tier) of the platform
    // Preferences should be normally used only by the engine code, and a persistent
    // shared store such as DataVault should be used by regular apps
    getSharedPreferences: function() {
        return _prefs;
    },

    // Get the root of the application
    // (In android, this is the virtual root of the APK)
    getRoot: function() {
        return process.cwd();
    },

    // Get a directory that is guaranteed to be writable
    // (in the private data space for Android)
    getWritableDir: function() {
        return filesDir;
    },

    // Get a temporary directory
    // Also guaranteed to be writable, but not guaranteed
    // to persist across reboots or for long times
    // (ie, it could be periodically cleaned by the system)
    getTmpDir: function() {
        return filesDir + '/tmp';
    },

    // Get a directory good for long term caching of code
    // and metadata
    getCacheDir: function() {
        return filesDir + '/cache';
    },

    // Get the filename of the sqlite database
    getSqliteDB: function() {
        return filesDir + '/sqlite.db';
    },

    // Stop the main loop and exit
    // (In Android, this only stops the node.js thread)
    // This function should be called by the platform integration
    // code, after stopping the engine
    exit: function() {
        return JXMobile.Exit();
    },

    // Change the auth token
    // Returns true if a change actually occurred, false if the change
    // was rejected
    setAuthToken: function(authToken) {
        var oldAuthToken = _prefs.get('auth-token');
        if (oldAuthToken !== undefined && authToken !== oldAuthToken)
            return false;
        _prefs.set('auth-token', authToken);
        return true;
    },

    get encoding() {
        return encoding;
    },

    // For internal use only
    _getPrivateFeature: function() {
        throw new Error('No private features on Android (yet)');
    },
};
