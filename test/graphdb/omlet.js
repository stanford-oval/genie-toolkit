// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const fs = require('fs');
const Url = require('url');
const Tp = require('thingpedia');

const Omlib = require('omlib');

const Messaging = require('./deps/messaging');

const API_KEY = '00109b1ea59d9f46d571834870f0168b5ed20005871d8752ff';
const API_SECRET = 'bccb852856c462e748193d6211c730199d62adcf0ba963416fcc715a2db4d76f';

class OmletStateStorage {
    constructor(platform) {
        this._prefs = platform.getSharedPreferences();
        this._storage = this._prefs.get('omlet');
        if (this._storage === undefined)
            this._prefs.set('omlet', this._storage = {});
    }

    key(idx) {
        return Object.keys(this._storage)[idx];
    }
    getItem(key) {
        return this._storage[key];
    }
    setItem(key, value) {
        this._storage[key] = value;
        this._prefs.changed();
    }
    removeItem(key) {
        delete this._storage[key];
        this._prefs.changed();
    }
    clear() {
        this._storage = {};
        this._prefs.changed();
    }
}

var storage_ = null;
var instance_ = null;

function safeMkdirSync(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

function makeOmletClient(platform, sync) {
    var dbpath = platform.getWritableDir() + '/omlet';
    safeMkdirSync(dbpath);
    var client = new Omlib({ instance: '',
                             storage: new OmletStateStorage(platform),
                             storagePath: dbpath,
                             sync: sync,
                             apiKey: { Id: API_KEY, Secret: API_SECRET } });
    client._ldClient.longdanMessageConsumer.DEBUG = false;
    return client;
}

module.exports = makeOmletClient;
