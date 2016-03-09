// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const fs = require('fs');

const Preferences = new lang.Class({
    Name: 'Preferences',
    Abstract: true,

    _init: function() {
    },

    // Retrieve the named preference, or undefined if there is no stored value for it
    get: function(name) {
        return undefined;
    },

    // Set the named preference to the given value, which can be any object for which
    // a valid JSON representation exists (any non-cyclic object without non enumerable
    // properties)
    set: function(name, value) {
        throw new Error('Abstract method');
    },
});

// Simple implementation of Preferences that uses a single file
const FilePreferences = new lang.Class({
    Name: 'FilePreferences',
    Extends: Preferences,

    _init: function(file) {
        this._file = file;
        try {
            this._prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch(e) {
            if (e.code != 'ENOENT')
                throw e;
            this._prefs = {};
            this._scheduleWrite();
        }
        this._writeScheduled = false;
    },

    keys: function() {
        return Object.keys(this._prefs);
    },

    get: function(name) {
        return this._prefs[name];
    },

    set: function(name, value) {
        this._prefs[name] = value;
        this._scheduleWrite();
        return value;
    },

    delete: function(name) {
        delete this._prefs[name];
        this._scheduleWrite();
    },

    changed: function() {
        this._scheduleWrite();
    },

    _scheduleWrite: function() {
        if (this._writeScheduled)
            return;

        setTimeout(function() {
            this._writeScheduled = false;
            fs.writeFile(this._file, JSON.stringify(this._prefs));
        }.bind(this), 100);
    }
});

module.exports = {
    Preferences: Preferences,
    FilePreferences: FilePreferences
};
