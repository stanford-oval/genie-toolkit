// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const fs = require('fs');
const path = require('path');
const events = require('events');
const lang = require('lang');
const adt = require('adt');
const Lokijs = require('lokijs');

const ThingEngineFSAdapter = new lang.Class({
    Name: 'ThingEngineFSAdapter',

    _init: function() {},

    loadDatabase: function(dbname, callback) {
        fs.readFile(path.join(platform.getWritableDir(), dbname), {
            encoding: 'utf8'
        }, function readFileCallback(err, data) {
            if (err) {
                callback(err);
            } else {
                callback(data);
            }
        });
    },

    saveDatabase: function(dbname, dbstring, callback) {
        fs.writeFile(path.join(platform.getWritableDir(), dbname), dbstring, callback);
    },
});

module.exports = new lang.Class({
    Name: 'EngineDatabase',
    Extends: Lokijs,

    _init: function() {
        Lokijs.call(this, 'thingengine', { autosave: true, autosaveInterval: 10000,
                                           adapter: new ThingEngineFSAdapter() });
    },

    start: function() {
        return Q.ninvoke(this, 'loadDatabase', {})
            .catch(function(e) {
                if (e.code !== 'ENOENT')
                    throw e;
            });
    },

    stop: function() {
        return Q.ninvoke(this, 'saveDatabase');
    }
});
