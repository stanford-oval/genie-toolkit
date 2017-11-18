// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

module.exports = class AppRunner {
    constructor(appdb) {
        this._db = appdb;
    }

    _startAllApps() {
        var apps = this._db.getAllApps();
        return Q.all(apps.map(this._startOneApp, this));
    }

    _stopAllApps() {
        var apps = this._db.getAllApps();
        return Q.all(apps.map(this._stopOneApp, this));
    }

    _startOneApp(a) {
        if (!a.isEnabled) {
            console.log('App ' + a.uniqueId  + ' is not enabled');
            return Q();
        }
        console.log('Starting app ' + a.uniqueId);

        return a.start().then(function() {
            a.isRunning = true;
            console.log('App ' + a.uniqueId  + ' started');
        }).timeout(30000, 'App start timed out').catch(function(e) {
            console.error('App failed to start: ' + e);
            console.error(e.stack);
        });
    }

    _stopOneApp(a) {
        if (!a.isRunning)
            return;
        console.log('Stopping app ' + a.uniqueId);

        return a.stop().then(function() {
            a.isRunning = false;
            console.log('App ' + a.uniqueId  + ' stopped');
        }).timeout(30000, 'App stop timed out').catch(function(e) {
            console.error('App failed to stop: ' + e);
            console.error(e.stack);
        });
    }

    _onAppChanged(a) {
        if (a.isRunning && !a.isEnabled)
            this._stopOneApp(a).done();
        else if (a.isEnabled && !a.isRunning)
            this._startOneApp(a).done();
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
}
