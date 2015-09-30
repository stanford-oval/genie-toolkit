// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var Q = require('q');

var express = require('express');
var router = express.Router();

var user = require('../util/user');

router.get('/', user.redirectLogIn, function(req, res, next) {
    var engine = req.app.engine;

    var devices = engine.devices.getAllDevices().filter(function(d) {
        return !d.hasKind('thingengine');
    });
    Q.all(devices.map(function(d) {
        return Q(d.checkAvailable()).then(function(avail) {
            return { uniqueId: d.uniqueId, name: d.name || "Unknown device",
                     description: d.description || "Description not available",
                     available: avail };
        });
    })).then(function(info) {
        res.render('devices_list', { page_title: 'ThingEngine - configured devices',
                                     csrfToken: req.csrfToken(),
                                     devices: info });
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

router.get('/factory/:kind', user.requireLogIn, function(req, res, next) {
    var engine = req.app.engine;
    var devFactory = engine.devices.factory;

    devFactory.getConfigUI(req.params.kind).then(function(ui) {
        return res.json(ui);
    }).catch(function(e) {
        console.log('Failed to get config UI: ' + e.message);
        console.log(e.stack);
        return res.status(404).json("Not found");
    }).done();
});

router.get('/create', user.redirectLogIn, function(req, res, next) {
    var engine = req.app.engine;
    var devFactory = engine.devices.factory;

    res.render('devices_create', { page_title: 'ThingEngine - configure device',
                                   csrfToken: req.csrfToken(),
                                   kinds: devFactory.SupportedKinds,
                                 });
});

router.post('/create', user.requireLogIn, function(req, res, next) {
    var engine = req.app.engine;
    var devices = engine.devices;

    try {
        if (typeof req.body['kind'] !== 'string' ||
            req.body['kind'].length == 0)
            throw new Error("You must choose one kind of device");

        delete req.body['_csrf'];

        devices.loadOneDevice(req.body, true).then(function() {
            res.redirect('/devices');
        }).catch(function(e) {
            res.status(400).render('error', { page_title: "ThingEngine - Error",
                                              message: e.message });
        }).done();
    } catch(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }
});

module.exports = router;
