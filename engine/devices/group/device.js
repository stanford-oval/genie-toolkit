// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const crypto = require('crypto');
const Q = require('q');

const BaseDevice = require('../../base_device');
const ObjectSet = require('../../object_set');

const GroupObjectSet = new lang.Class({
    Name: 'GroupObjectSet',
    Extends: ObjectSet.Simple,

    _init: function(engine, devices) {
        this.parent(false);

        devices.forEach(function(d) {
            try {
                this.addOne(engine.devices.getDevice(d));
            } catch(e) {
                return null;
            }
        }, this);

        // FIXME: mutation
        this.freeze();
    }
});

const GroupDevice = new lang.Class({
    Name: 'GroupDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        // let the device db pick a uniqueId for this group
        // this.uniqueId = undefined;

        this.name = "Group %s".format(this.state.name);
        this.description = "This is a group of devices. You can share it on a chat room to give people access to it.";
    },

    get devices() {
        return this.state.devices;
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },

    queryInterface: function(iface) {
        if (iface === 'device-group')
            return new GroupObjectSet(this);
        else
            return null;
    },
});

function createDevice(engine, state) {
    return new GroupDevice(engine, state);
}

module.exports.createDevice = createDevice;
