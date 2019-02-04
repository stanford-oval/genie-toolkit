// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = class BluetoothGenericDevice extends Tp.BaseDevice {
    static loadFromDiscovery(engine, publicData, privateData) {
        return new BluetoothGenericDevice(engine,
                                          { kind: 'org.thingpedia.builtin.bluetooth.generic',
                                            discoveredBy: engine.ownTier,
                                            paired: privateData.paired,
                                            uuids: publicData.uuids,
                                            class: publicData.class,
                                            hwAddress: privateData.address,
                                            alias: privateData.alias });
    }

    constructor(engine, state) {
        super(engine, state);

        this.alias = state.alias;
        this.hwAddress = state.hwAddress;

        this.uniqueId = 'org.thingpedia.builtin.bluetooth.generic-' + state.hwAddress.replace(/:/g,'-');
        this.descriptors = ['bluetooth/' + state.hwAddress];

        this.name = this.engine._("Generic Bluetooth Device %s").format(this.alias);
        this.description = this.engine._("This is a Bluetooth device of unknown or generic type");
    }

    completeDiscovery(delegate) {
        if (this.state.paired) {
            this.engine.devices.addDevice(this);
            delegate.configDone();
            return Promise.resolve();
        }

        if (!this.engine.platform.hasCapability('bluetooth')) {
            delegate.configFailed(new Error(this.engine._("Platform has no bluetooth capability")));
            return Promise.resolve();
        }

        var btApi = this.engine.platform.getCapability('bluetooth');
        return btApi.pairDevice(this.hwAddress).then(() => {
            this.state.paired = true;
            this.engine.devices.addDevice(this);
            delegate.configDone();
        }).catch((e) => {
            delegate.configFailed(e);
        });
    }

    checkAvailable() {
        if (!this.engine.platform.hasCapability('bluetooth'))
            return Tp.Availability.UNAVAILABLE;

        var btApi = this.engine.platform.getCapability('bluetooth');
        return btApi.readUUIDs(this.hwAddress).then((uuids) => {
            if (uuids !== null)
                return Tp.Availability.AVAILABLE;
            else
                return Tp.Availability.UNAVAILABLE;
        });
    }
};
