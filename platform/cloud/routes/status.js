// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const express = require('express');
const child_process = require('child_process');

const user = require('../util/user');
const model = require('../model/user');
const db = require('../util/db');

var TITLE = "ThingEngine";

const EngineManager = require('../enginemanager');

var router = express.Router();

function readLogs(userId) {
    return Q.nfcall(child_process.execFile, '/usr/bin/journalctl',
                    ['-n', '100', '-o', 'json', '-u', 'thingengine-cloud',
                     'THINGENGINE_USER_ID=' + userId],
                     { killSignal: 'SIGINT' })
        .spread(function(stdout, stderr) {
            return stdout.trim().split('\n').map(JSON.parse);
        }).catch(function(e) {
            console.log(e.stack);
            return [];
        });
}

function getCachedModules(userId) {
    return EngineManager.get().getEngine(userId).then(function(engine) {
        return engine.devices.factory;
    }).then(function(devFactory) {
        return devFactory.getCachedModules();
    }).catch(function(e) {
        console.log('Failed to retrieve cached modules: ' + e.message);
        return [];
    });
}

router.get('/', user.redirectLogIn, function(req, res, next) {
    Q.all([readLogs(req.user.id), getCachedModules(req.user.id)]).spread(function(lines, modules) {
        res.render('status', { page_title: "ThingEngine - Status",
                               csrfToken: req.csrfToken(),
                               log: lines,
                               modules: modules,
                               isRunning: EngineManager.get().isRunning(req.user.id) });
    }).done();
});

router.post('/kill', user.requireLogIn, function(req, res) {
    var engineManager = EngineManager.get();

    engineManager.killUser(req.user.id);
    res.redirect('/status');
});

router.post('/start', user.requireLogIn, function(req, res) {
    var engineManager = EngineManager.get();

    if (engineManager.isRunning(req.user.id))
        engineManager.killUser(req.user.id);

    engineManager.startUser(req.user).then(function() {
        res.redirect('/status');
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

router.post('/update-module/:kind', user.requireLogIn, function(req, res) {
    return EngineManager.get().getEngine(req.user.id).then(function(engine) {
        return engine.devices.updateDevicesOfKind(req.params.kind);
    }).then(function() {
        res.redirect('/status');
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

module.exports = router;
