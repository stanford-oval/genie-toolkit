// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');

const channel = require('./channel');
const db = require('./db');

const Engine = new lang.Class({
    Name: 'Engine',

    _init: function() {
        // constructor
    },

    start: function() {
        return platform.init()
            .then(function() {
                return (new channel.ChannelFactory()).load();
            })
            .then(function() {
                return (new db.DeviceDatabase()).load();
            })
            .then(function() {
                return (new db.RuleDatabase()).load();
            })
            .then(function() {
                console.log('Engine started');
            });
    },

    run: function() {
        console.log('Engine running');
        // and immediately dying
        return Q(true);
    },

    stop: function() {
        console.log('Engine stopped');
        return Q(true);
    }
});

module.exports = Engine;
