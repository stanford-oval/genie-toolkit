// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

function makeSimpleChannelClass(kind) {
    return new Tp.ChannelClass({
        Name: 'SimpleChannel' + kind,

        sendEvent: function(event) {
        }
    });
}

module.exports = new Tp.DeviceClass({
    Name: 'AlmondDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        this.uniqueId = 'thingengine-own-sabrina';
        this.isTransient = true;
    },

    getTriggerClass: function(name) {
        switch (name) {
        case 'listen':
        case 'onpicture':
            return makeSimpleChannelClass(name);
        default:
            throw new Error('Invalid trigger ' + name);
        }
    },

    getActionClass: function(name) {
        switch (name) {
        case 'say':
        case 'picture':
            return makeSimpleChannelClass(name);
        default:
            throw new Error('Invalid action ' + name);
        }
    }
});
