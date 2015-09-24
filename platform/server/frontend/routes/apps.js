// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var express = require('express');
var router = express.Router();

var user = require('../util/user');
var AppGrammar = require('../../engine/app_grammar');

function appsList(req, res, next, message) {
    var engine = req.app.engine;

    var apps = engine.apps.getAllApps();
    var info = apps.map(function(a) {
        return { uniqueId: a.uniqueId, name: a.name || "Some app",
                 running: a.isRunning, enabled: a.isEnabled,
                 currentTier: a.currentTier };
    });

    res.render('apps_list', { page_title: 'ThingEngine - installed apps',
                              message: message,
                              csrfToken: req.csrfToken(),
                              apps: info });
}

router.get('/', user.redirectLogIn, function(req, res, next) {
    appsList(req, res, next, '');
});

router.get('/create', user.redirectLogIn, function(req, res, next) {
    res.render('apps_create', { page_title: 'ThingEngine - create app',
                                csrfToken: req.csrfToken(),
                              });
});

router.post('/create', user.requireLogIn, function(req, res, next) {
    try {
        var code = req.body['code'];
        var parsed = AppGrammar.parse(code);
        var tier = req.body.tier;
        if (tier !== 'server' && tier !== 'cloud' && tier !== 'phone')
            throw new Error('No such tier ' + tier);

        var engine = req.app.engine;

        engine.apps.loadOneApp(code, {}, undefined, tier, true).then(function() {
            appsList(req, res, next, "Application successfully created");
        }).catch(function(e) {
            res.status(400).render('error', { page_title: "ThingEngine - Error",
                                              message: e.message });
        }).done();
    } catch(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
        return;
    }
});

router.post('/delete', user.requireLogIn, function(req, res, next) {
    try {
        var engine = req.app.engine;

        var id = req.body.id;
        var app = engine.apps.getApp(id);
        if (app === undefined) {
            res.status(404).render('error', { page_title: "ThingEngine - Error",
                                              message: "Not found." });
            return;
        }

        engine.apps.removeApp(app).then(function() {
            appsList(req, res, next, "Application successfully deleted");
        }).catch(function(e) {
            res.status(400).render('error', { page_title: "ThingEngine - Error",
                                              message: e.message + '\n' + e.stack });
        }).done();
    } catch(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message + '\n' + e.stack });
        return;
    }
});

router.get('/:id/show', user.redirectLogIn, function(req, res, next) {
    var engine = req.app.engine;

    var app = engine.apps.getApp(req.params.id);
    if (app === undefined) {
        res.status(404).render('error', { page_title: "ThingEngine - Error",
                                          message: "Not found." });
        return;
    }

    return res.render('show_app', { page_title: "ThingEngine App",
                                    name: app.name || "Some app",
                                    description: app.description || '',
                                    csrfToken: req.csrfToken(),
                                    code: app.code,
                                    settings: app.settings,
                                    state: app.state });
});

router.post('/:id/update', user.requireLogIn, function(req, res, next) {
    var engine = req.app.engine;

    var app = engine.apps.getApp(req.params.id);
    if (app === undefined) {
        res.status(404).render('error', { page_title: "ThingEngine - Error",
                                          message: "Not found." });
        return;
    }

    // do something
    res.status(500).render('error', { page_title: "ThingEngine - Error",
                                      message: "Broken." });
});

module.exports = router;
