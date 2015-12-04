// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const fs = require('fs');
const lang = require('lang');

const BaseDiscovery = require('./discovery');

const INTERFACE_NAME = "edu.stanford.thingengine.DeviceDiscovery";
const BUS_NAME = "edu.stanford.thingengine.DeviceDiscovery";
const OBJECT_PATH = "/edu/stanford/thingengine/DeviceDiscovery";

const APPLICATION_NAME = "edu.stanford.thingengine";
const SESSION_PORT = 1;

const DISCOVER_METHOD = "Hello";

module.exports = new lang.Class({
    Name: 'AllJoynDiscovery',
    Extends: BaseDiscovery,

    get isSupported() {
        return platform.hasCapability('alljoyn');
    },

    start: function() {
        this._allJoyn = platform.getCapability('alljoyn');

        this._allJoyn.start(APPLICATION_NAME);

        var iface = this._allJoyn.createInterface(INTERFACE_NAME,
                                                  { signals: {},
                                                    methods: {
                                                        'Hello': ['(sa{sv}a{sv})', '()', 'descr,pubdata,privdata']
                                                    }
                                                  });

        var obj = this._allJoyn.createObject(OBJECT_PATH, [iface]);
        //obj.addMethodHandler(DISCOVER_METHOD, this._onHello.bind(this));
        this._allJoyn.exportObject(obj);

        this._allJoyn.exportSessionPort(SESSION_PORT);
        this._allJoyn.exportName(BUS_NAME);

        return Q();
    },

    _onHello: function(descriptor, publicData, privateData) {
        this.deviceFound('alljoyn/' + descriptor, publicData, privateData);
    },

    stop: function() {
        this._allJoyn.unexportName(BUS_NAME);

        return Q();
    }
});
