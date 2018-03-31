// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const fs = require('fs');

module.exports = class ThingEngineGNOMEDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._tierManager = engine.tiers;

        this.uniqueId = 'org.thingpedia.builtin.thingengine.gnome';

        this.name = this.engine._("Almond 4 GNOME");
        this.description = this.engine._("Control your PC with your voice.");
    }

    get ownerTier() {
        return Tp.Tier.SERVER; // FIXME
    }

    checkAvailable() {
        if (Tp.Tier.SERVER === this._tierManager.ownTier) {
            return Tp.Availability.AVAILABLE;
        } else {
            return (this._tierManager.isConnected(Tp.Tier.SERVER) ?
                    Tp.Availability.AVAILABLE :
                    Tp.Availability.OWNER_UNAVAILABLE);
        }
    }

    get_get_screenshot() {
        return this.engine.platform.getCapability('screenshot').take().then((url) => {
            return [{ picture_url: url }];
        });
    }

    do_open_app({ app_id, url }) {
        if (url)
            return this.engine.platform.getCapability('app-launcher').launchApp(String(app_id), String(url));
        else
            return this.engine.platform.getCapability('app-launcher').launchApp(String(app_id));
    }
    do_lock() {
        return this.engine.platform.getCapability('system-lock').lock();
    }
    do_set_background({ picture_url }) {
        return this.engine.platform.getCapability('system-settings').setBackground(String(picture_url));
    }
    do_create_file({ file_name, contents }) {
        return new Promise((resolve, reject) => {
            fs.writeFile(String(file_name), contents, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    do_delete_file({ file_name }) {
        return new Promise((resolve, reject) => {
            fs.unlink(String(file_name), (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
};