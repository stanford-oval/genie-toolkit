// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');
var router = express.Router();

var user = require('../util/user');
var appui = require('../../shared/util/appui');

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
        var parsed = JSON.parse(req.body['json-blob']);
        var tier = req.body.tier;
        if (tier !== 'server' && tier !== 'cloud' && tier !== 'phone')
            throw new Error('No such tier ' + tier);

        var engine = req.app.engine;

        engine.apps.loadOneApp(parsed, tier, true).then(function() {
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
                                              message: e.message });
        }).done();
    } catch(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
        return;
    }
});

function uiCommand(req, res, next, call, command) {
    var engine = req.app.engine;

    var app = engine.apps.getApp(req.params.id);
    if (app === undefined) {
        res.status(404).render('error', { page_title: "ThingEngine - Error",
                                          user: { loggedIn: user.isLoggedIn(req) },
                                          message: "Not found." });
        return;
    }

    var output = app[call](command);
    if (typeof output === 'string')
        res.send(output);
    else
        appui.renderApp(req.params.id, output[0], output[1], req, res, next);
}

router.get('/:id/:command', user.redirectLogIn, function(req, res, next) {
    uiCommand(req, res, next, 'showUI', req.params.command);
});

router.post('/:id/:command', user.requireLogIn, function(req, res, next) {
    uiCommand(req, res, next, 'postUI', req.params.command);
});

var staticCache = {};

router.use('/:id/static', user.requireLogIn, function(req, res, next) {
    var appId = req.params.id;

    if (staticCache[appId] === undefined) {
        var app = req.app.engine.apps.getApp(appId);

        if (app !== undefined && app.filename) {
            var root = path.join(path.dirname(app.filename), 'static');
            staticCache[appId] = express.static(root);
        } else {
            staticCache[appId] = null;
        }
    }

    var middleware = staticCache[appId];
    if (middleware !== null)
        middleware(req, res, next);
    else
        res.status(404).render('error', { page_title: "ThingEngine - Error",
                                          message: "Not found." });
});


module.exports = router;
