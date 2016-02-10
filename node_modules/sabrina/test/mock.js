// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');

const Preferences = new lang.Class({
    Name: 'MockPreferences',

    _init: function() {
        this._store = {};

        // change this line to test the initialization dialog
        this._store['sabrina-initialized'] = true;
        this._store['sabrina-name'] = "Alice Tester";
    },

    get: function(name) {
        return this._store[name];
    },

    set: function(name, value) {
        this._store[name] = value;
    },
});

global.platform = {
    _prefs: new Preferences(),

    getSharedPreferences: function() {
        return this._prefs;
    },
};

const Keyword = new lang.Class({
    Name: 'MockKeyword',

    _init: function() {
        this.value = null;
    },

    open: function() {
        return Q();
    },

    close: function() {
        return Q();
    },

    changeValue: function(v) {
        this.value = v;
    }
});

function makeKey(scope, name, feedId) {
    var key;

    if (scope) {
        key = scope + '-' + name;

        // we don't need to put the full feedId in the keyword name,
        // it is already implied by the app
        if (feedId)
            key += '-F';
    } else {
        key = 'extern-' + name;

        if (feedId)
            key += feedId.replace(/[^a-zA-Z0-9]+/g, '-');
    }

    return key;
}

const KeywordRegistry = new lang.Class({
    Name: 'MockKeywordRegistry',

    _init: function() {
        this._keywords = {};
    },

    getKeyword: function(scope, name, feedId) {
        var key = makeKey(scope, name, feedId);
        if (!this._keywords[key]) {
            if (feedId)
                throw new TypeError();
            else
                this._keywords[key] = new Keyword();
        }

        return this._keywords[key];
    }
});

const AppDatabase = new lang.Class({
    Name: 'MockAppDatabase',

    _init: function() {
        this._apps = {};
    },

    getApp: function(appId) {
        return this._apps[appId];
    },

    loadOneApp: function(code, state, appId, tier, save) {
        console.log('App ' + appId + ' with code ' + code + ' loaded');
        this._apps[appId] = { code: code, state: state, uniqueId: appId };
        return Q();
    },
});

const Channel = new lang.Class({
    Name: 'Channel',

    _init: function(device, id) {
        this.uniqueId = device + '-' + id;
    },

    open: function() { return Q(); },
    close: function() { return Q(); },

    sendEvent: function(event) {
        console.log('Sending event ' + JSON.stringify(event) + ' on channel ' + this.uniqueId);
    }
});

const TwitterDevice = new lang.Class({
    Name: 'MockTwitterDevice',

    _init: function(who) {
        this.name = "Twitter Account " + who;
        this.kind = 'twitter';
        this.uniqueId = 'twitter-' + who;
    },

    getChannel: function(id) {
        return Q(new Channel(this.uniqueId, id));
    }
});

const DeviceDatabase = new lang.Class({
    Name: 'MockDeviceDatabase',

    _init: function() {
        this._devices = {};
        this._devices['twitter-foo'] = new TwitterDevice('foo');
    },

    getAllDevices: function() {
        return Object.keys(this._devices).map(function(k) { return this._devices[k]; }, this);
    },

    getAllDevicesOfKind: function(kind) {
        return this.getAllDevices().filter(function(d) { return d.kind === kind; });
    }
});

const Messaging = new lang.Class({
    Name: 'MockMessaging',

    _init: function() {},

    getOwnId: function() { return Q(0); },

    getUserById: function(id) {
        if (id !== 0)
            throw new Error('Invalid user id');
        return Q({ name: 'Alice Tester' });
    }
});

module.exports.createMockEngine = function() {
    return {
        messaging: new Messaging(),
        keywords: new KeywordRegistry(),
        devices: new DeviceDatabase(),
        apps: new AppDatabase()
    };
};
