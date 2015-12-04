// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');

const Thingpedia = require('./thingpedia');

module.exports = new lang.Class({
    Name: 'BaseDiscoveryModule',
    Abstract: true,

    _init: function(db, factory) {
        this.db = db;
        this.factory = factory;

        this._inflightRequests = {};
    },

    get isSupported() {
        return true;
    },

    deviceFound: function(descriptor, publicData, privateData) {
        var existing = this.db.getDeviceByDescriptor(descriptor);

        if (existing) {
            try {
                existing.updateFromDiscovery(data);
                return;
            } catch(e) {
                console.log('Updating device from discovery failed, removing...');
                this.db.removeDevice(existing);
            }
        }

        if (descriptor in this._inflightRequests)
            return;

        this._inflightRequests[descriptor] = Thingpedia.getKindByDiscovery(publicData)
            .then(function(response) {
                return this.db.factory.addFromDiscovery(response, publicData, privateData);
            }.bind(this)).catch(function(e) {
                console.log('Failed to add device from discovery: ' + e.message);
            }).finally(function() {
                delete this._inflightRequests[descriptor];
            }.bind(this));

        this._inflightRequests[descriptor].done();
    },
});
