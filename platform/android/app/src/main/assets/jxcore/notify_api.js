// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const JavaAPI = require('./java_api');
const NotifyJavaAPI = JavaAPI.makeJavaAPI('Notify', [], ['showMessage']);

module.exports = {
    showMessage: function(title, msg) {
        console.log('About to show message ' + title + ', ' + msg);
        NotifyJavaAPI.showMessage(title, msg).done();
    }
};
