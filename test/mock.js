// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

class MockPreferences {
    constructor() {
        this._store = {};

        // change this line to test the initialization dialog
        this._store['sabrina-initialized'] = true;
        this._store['sabrina-name'] = "Alice Tester";
    }

    get(name) {
        return this._store[name];
    }

    set(name, value) {
        this._store[name] = value;
    }
}

class MockAppDatabase {
    constructor() {
        this._apps = {};
    }

    getApp(appId) {
        return this._apps[appId];
    }

    loadOneApp(code, state, uniqueId, tier, name, description, addToDB) {
        console.log('MOCK: App ' + name + ' with code ' + code + ' loaded');
        this._apps[uniqueId] = { code: code, state: state, uniqueId: uniqueId };
        return Q();
    }
}

class MockTwitterDevice {
    constructor(who) {
        this.name = "Twitter Account " + who;
        this.kind = 'twitter';
        this.uniqueId = 'twitter-' + who;
    }

    invokeAction(id, args) {
        console.log('MOCK: Invoking action ' + id + ' with arguments', args);
    }
}

class MockDeviceDatabase {
    constructor() {
        this._devices = {};
        this._devices['twitter-foo'] = new MockTwitterDevice('foo');
        this._devices['twitter-bar'] = new MockTwitterDevice('bar');
    }

    getAllDevices() {
        return Object.keys(this._devices).map(function(k) { return this._devices[k]; }, this);
    }

    getAllDevicesOfKind(kind) {
        return this.getAllDevices().filter(function(d) { return d.kind === kind; });
    }
}

var _mockSchemaRetriever = {
    _schema: {
        "twitter": {
            "triggers": {
                "source": ["String","Array(String)","Array(String)","String","String","Boolean"],
            },
            "actions": {
                "sink": ["String"]
            },
            "queries": {
                "retweets_of_me": ["String","Array(String)","Array(String)","String"]
            }
        },
    },

    _meta: {
        "twitter": {
            "triggers": {
                "source": {
                    "doc": "I receive a tweet",
                    "schema": ["String","Array(String)","Array(String)","String","String","Boolean"],
                    "args": ["text", "hashtags", "urls", "from", "inReplyTo", "yours"],
                    "questions": []
                }
            },
            "actions": {
                "sink": {
                    "doc": "post a tweet",
                    "schema": ["String"],
                    "args": ["text"],
                    "questions": ["What do you want me to tweet?"]
                }
            }
        }
    },

    getSchema: function(kind) {
        if (kind in this._schema)
            return Q.delay(1).then(function() {
                return this._schema[kind];
            }.bind(this));
        else
            return Q.reject(new Error("No such schema " + kind));
    },

    getMeta: function(kind) {
        if (kind in this._meta)
            return Q.delay(1).then(function() {
                return this._meta[kind];
            }.bind(this));
        else
            return Q.reject(new Error("No such schema " + kind));
    }
};

module.exports.createMockEngine = function() {
    return {
        platform: {
            _prefs: new MockPreferences(),

            getSharedPreferences() {
                return this._prefs;
            },
        },
        schemas: _mockSchemaRetriever,
        devices: new MockDeviceDatabase(),
        apps: new MockAppDatabase()
    };
};
