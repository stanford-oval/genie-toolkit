// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var Q = require('q');
var express = require('express');

var user = require('../util/user');
var EngineManager = require('../enginemanager');

var router = express.Router();

router.get('/', user.redirectLogIn, function(req, res, next) {
    if (req.query.class && ['online', 'physical'].indexOf(req.query.class) < 0) {
        res.status(404).render('error', { page_title: "ThingEngine - Error",
                                          message: "Invalid device class" });
        return;
    }

    var online = req.query.class === 'online';

    EngineManager.get().getEngine(req.user.id).then(function(engine) {
        return engine.devices.getAllDevices();
    }).then(function(devices) {
        return Q.all(devices.map(function(d) {
            return Q.all([d.uniqueId, d.name, d.description, d.checkAvailable(),
                          d.hasKind('online-account'), d.hasKind('thingengine')])
                .spread(function(uniqueId, name, description, available, isOnlineAccount, isThingEngine) {
                    return { uniqueId: uniqueId, name: name || "Unknown device",
                             description: description || "Description not available",
                             available: available,
                             isOnlineAccount: isOnlineAccount,
                             isThingEngine: isThingEngine };
                });
        }));
    }).then(function(devinfo) {
        devinfo = devinfo.filter(function(d) {
            if (d.isThingEngine)
                return false;

            if (online)
                return d.isOnlineAccount;
            else
                return !d.isOnlineAccount;
        });

        res.render('devices_list', { page_title: 'ThingEngine - configured devices',
                                     csrfToken: req.csrfToken(),
                                     onlineAccounts: online,
                                     devices: devinfo });
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

router.get('/factory/:kind', user.requireLogIn, function(req, res, next) {
    EngineManager.get().getEngine(req.user.id).then(function(engine) {
        return engine.devices.factory;
    }).then(function(devFactory) {
        return devFactory.getConfigUI(req.params.kind);
    }).then(function(ui) {
        return res.json(ui);
    }).catch(function(e) {
        console.log('Failed to get config UI: ' + e.message);
        console.log(e.stack);
        return res.status(404).json("Not found");
    }).done();
});

router.get('/create', user.redirectLogIn, function(req, res, next) {
    if (req.query.class && ['online', 'physical'].indexOf(req.query.class) < 0) {
        res.status(404).render('error', { page_title: "ThingEngine - Error",
                                          message: "Invalid device class" });
        return;
    }

    var online = req.query.class === 'online';

    EngineManager.get().getEngine(req.user.id).then(function(engine) {
        return engine.devices.factory;
    }).then(function(devFactory) {
        return devFactory.SupportedKinds;
    }).then(function(kinds) {
        kinds = kinds.filter(function(k) {
            return k.online === online;
        });

        res.render('devices_create', { page_title: 'ThingEngine - configure device',
                                       csrfToken: req.csrfToken(),
                                       kinds: kinds,
                                       onlineAccounts: online,
                                     });
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

router.post('/create', user.requireLogIn, function(req, res, next) {
    if (req.query.class && ['online', 'physical'].indexOf(req.query.class) < 0) {
        res.status(404).render('error', { page_title: "ThingEngine - Error",
                                          message: "Invalid device class" });
        return;
    }

    EngineManager.get().getEngine(req.user.id).then(function(engine) {
        var devices = engine.devices;

        if (typeof req.body['kind'] !== 'string' ||
            req.body['kind'].length == 0)
            throw new Error("You must choose one kind of device");

        delete req.body['_csrf'];
        return devices.loadOneDevice(req.body, true);
    }).then(function() {
        res.redirect('/devices?class=' + (req.query.class || 'physical'));
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

module.exports = router;
