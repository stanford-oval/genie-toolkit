// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

// Set up a mock jxcore and run the app

global.JXMobile = function(name) {
    if (!(this instanceof JXMobile)) return new JXMobile(name);

    this.name = name;
}

JXMobile.prototype.callNative = function() {
    console.log('JXMobile-Mock: native function ' + this.name + ' called');
};

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

JXMobile.Exit = function() {
    process.exit();
};

require('./jxcore/app');
natives['runEngine']();
