// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2015-2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// Testing/single user platform

const Q = require('q');
const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');
const Almond = require('almond');

const prefs = require('../lib/util/prefs');
const sql = require('../lib/db/sqlite');

var Config;
try {
Config = require('./platform_config');
} catch(e) {
Config = {};
}

var _writabledir = null;
var _prefs = null;

var _unzipApi = {
    unzip: function(zipPath, dir) {
        var args = ['-uo', zipPath, '-d', dir];
        return Q.nfcall(child_process.execFile, '/usr/bin/unzip', args, {
            maxBuffer: 10 * 1024 * 1024 }).then(function(zipResult) {
            var stdout = zipResult[0];
            var stderr = zipResult[1];
            console.log('stdout', stdout);
            console.log('stderr', stderr);
        });
    }
};

class Assistant {
    constructor(engine, user, delegate) {
        this._conversation = new Almond(engine, 'test', user, delegate,
        { debug: false, showWelcome: true });
    }

    notifyAll(data) {
        this._conversation.notify(data);
    }

    notifyErrorAll(data) {
        this._conversation.notifyErrorAll(data);
    }

    getConversation(id) {
        return this._conversation;
    }
}

module.exports = {
    // Initialize the platform code
    // Will be called before instantiating the engine
    init: function(rl) {
        _writabledir = '.';
        try {
            fs.mkdirSync(_writabledir + '/cache');
        } catch(e) {
            if (e.code != 'EEXIST')
                throw e;
        }

        this._assistant = null;

        _prefs = new prefs.FilePreferences(_writabledir + '/prefs.db');
    },

    createAssistant(engine, user, delegate) {
        this._assistant = new Assistant(engine, user, delegate);
    },

    type: 'testing',
    locale: process.env.LANG,

    // Check if we need to load and run the given thingengine-module on
    // this platform
    // (eg we don't need discovery on the cloud, and we don't need graphdb,
    // messaging or the apps on the phone client)
    hasFeature(feature) {
        // enable everything for testing, we mock it out anyway
        return true;
    },

    // Check if this platform has the required capability
    // (eg. long running, big storage, reliable connectivity, server
    // connectivity, stable IP, local device discovery, bluetooth, etc.)
    //
    // Which capabilities are available affects which apps are allowed to run
    hasCapability: function(cap) {
        switch(cap) {
        case 'code-download':
            // If downloading code from the thingpedia server is allowed on
            // this platform
            return true;

        case 'assistant':
            // If we can create a full AssistantManager (because the platform
            // will back with a Almond account)
            return this._assistant !== null;

        default:
            return false;
        }
    },

    // Retrieve an interface to an optional functionality provided by the
    // platform
    //
    // This will return null if hasCapability(cap) is false
    getCapability: function(cap) {
        switch(cap) {
        case 'code-download':
            // We have the support to download code
            return _unzipApi;

        case 'assistant':
            return this._assistant;

        default:
            return null;
        }
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
    // (in the private data space for Android, in /var/lib for server)
    getWritableDir: function() {
        return _writabledir;
    },

    // Get a directory good for long term caching of code
    // and metadata
    getCacheDir: function() {
        return _writabledir + '/cache';
    },

    // Make a symlink potentially to a file that does not exist physically
    makeVirtualSymlink: function(file, link) {
        fs.symlinkSync(file, link);
    },

    // Get a temporary directory
    // Also guaranteed to be writable, but not guaranteed
    // to persist across reboots or for long times
    // (ie, it could be periodically cleaned by the system)
    getTmpDir: function() {
        return os.tmpdir();
    },

    getSqliteKey: function() {
        return process.env.THINGENGINE_SQLITE_KEY;
    },

    // Get the filename of the sqlite database
    getSqliteDB: function() {
        return _writabledir + '/sqlite.db';
    },

    getGraphDB: function() {
        return _writabledir + '/rdf.db';
    },

    // Stop the main loop and exit
    // (In Android, this only stops the node.js thread)
    // This function should be called by the platform integration
    // code, after stopping the engine
    exit: function() {
        return process.exit();
    },

    // Get the Thingpedia developer key, if one is configured
    getDeveloperKey: function() {
        return _prefs.get('developer-key');
    },

    // Change the Thingpedia developer key, if possible
    // Returns true if the change actually happened
    setDeveloperKey: function(key) {
        return _prefs.set('developer-key', key);
        return true;
    },

    // Return a server/port URL that can be used to refer to this
    // installation. This is primarily used for OAuth redirects, and
    // so must match what the upstream services accept.
    getOrigin: function() {
        return 'http://127.0.0.1:3000';
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
    }

};
