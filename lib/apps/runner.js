// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

module.exports = class AppRunner {
    constructor(appdb) {
        this._db = appdb;
    }

    _startAllApps() {
        var apps = this._db.getAllApps();
        return Promise.all(apps.map(this._startOneApp, this));
    }

    _stopAllApps() {
        var apps = this._db.getAllApps();
        return Promise.all(apps.map(this._stopOneApp, this));
    }

    _startOneApp(a) {
        if (!a.isEnabled) {
            console.log('App ' + a.uniqueId  + ' is not enabled');
            return Promise.resolve();
        }
        console.log('Starting app ' + a.uniqueId);

        return Promise.race([
            a.start(),
            new Promise((resolve, reject) => {
                setTimeout(reject, 30000, new Error('App start timed out'));
            })
        ]).then(() => {
            a.isRunning = true;
        }).catch((e) => {
            console.error('App failed to start: ' + e);
            console.error(e.stack);
        });
    }

    _stopOneApp(a) {
        if (!a.isRunning)
            return Promise.resolve();
        console.log('Stopping app ' + a.uniqueId);

        return Promise.race([
            a.stop(),
            new Promise((resolve, reject) => {
                setTimeout(reject, 30000, new Error('App stop timed out'));
            })
        ]).then(() => {
            a.isRunning = false;
        }).catch((e) => {
            console.error('App failed to stop: ' + e);
            console.error(e.stack);
        });
    }

    _onAppChanged(a) {
        if (a.isRunning && !a.isEnabled)
            this._stopOneApp(a);
        else if (a.isEnabled && !a.isRunning)
            this._startOneApp(a);
    }

    start() {
        return this._startAllApps().then(() => {
            this._db.on('app-added', this._startOneApp.bind(this));
            this._db.on('app-removed', this._stopOneApp.bind(this));
            this._db.on('app-changed', this._onAppChanged.bind(this));
        });
    }

    stop() {
        return this._stopAllApps();
    }
};
