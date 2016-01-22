// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

// Set up a mock jxcore and run the app

const path = require('path');
const prefs = require('./jxcore/engine/prefs');

global.JXMobile = function(name) {
    if (!(this instanceof JXMobile)) return new JXMobile(name);

    this.name = name;
}

JXMobile.prototype.callNative = function() {
    console.log('JXMobile-Mock: native function ' + this.name + ' called');
    var callback = arguments[arguments.length-1];
    if (callback)
        callback(null, null);
};

JXMobile.prototype.callAsyncNative = function(callback) {
    console.log('JXMobile-Mock: async native function ' + this.name + ' called');
    var callback = arguments[arguments.length-1];
    if (callback)
        callback(null, null);
}

var natives = {}

JXMobile.prototype.registerToNative = function(callback) {
    console.log('JXMobile-Mock: function ' + this.name + ' registered for native call');
    natives[this.name] = callback;
};

JXMobile.GetEncoding = function(callback) {
    callback(null, 'utf8');
};

JXMobile.GetDocumentsPath = function(callback) {
    callback(null, process.cwd());
};

JXMobile.GetCachePath = function(callback) {
    callback(null, path.resolve(process.cwd(), 'cache'));
};

JXMobile.GetSharedPreferences = function(callback) {
    callback(null, new prefs.FilePreferences(process.cwd() + '/prefs.db'));
};

JXMobile.Exit = function() {
    process.exit();
};

require('./jxcore/app');
console.log('Modules loaded');
natives['runEngine']();
