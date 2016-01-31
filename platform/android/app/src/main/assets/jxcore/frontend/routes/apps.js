// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const express = require('express');
var router = express.Router();

const ThingTalk = require('thingtalk');
const AppCompiler = ThingTalk.Compiler;

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

router.get('/', function(req, res, next) {
    appsList(req, res, next, '');
});

function appsCreate(error, req, res) {
    return feeds.getFeedList(req.app.engine, false).then(function(feeds) {
        res.render('apps_create', { page_title: 'ThingEngine - create app',
                                    csrfToken: req.csrfToken(),
                                    error: error,
                                    code: req.body.code,
                                    parameters: req.body.params || '{}',
                                    tier: req.body.tier || 'phone',
                                    omlet: { feeds: feeds,
                                             feedId: req.body.feedId }
                                  });
    });
}

router.get('/create', user.redirectLogIn, function(req, res, next) {
    appsCreate(undefined, req, res).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

router.post('/create', user.requireLogIn, function(req, res, next) {
    Q.try(function() {
        var code = req.body.code;
        var state, tier;
        try {
            // sanity check the app
            var compiler = new AppCompiler();
            compiler.compileCode(code);

            state = JSON.parse(req.body.params);
            if (compiler.feedAccess) {
                if (!state.$F && !req.body.feedId)
                    throw new Error('Missing feed for feed-shared app');
                if (!state.$F)
                    state.$F = req.body.feedId;
            } else {
                delete state.$F;
            }

            tier = req.body.tier;
            if (tier !== 'server' && tier !== 'cloud' && tier !== 'phone')
                throw new Error('No such tier ' + tier);
        } catch(e) {
            return appsCreate(e.message, req, res);
        }

        var engine = req.app.engine;
        return engine.apps.loadOneApp(code, state, undefined, tier, true).then(function() {
            appsList(req, res, next, "Application successfully created");
        });
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

router.post('/delete', function(req, res, next) {
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

router.get('/:id/show', function(req, res, next) {
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
                                    params: JSON.stringify(app.state),
                                    settings: app.settings });
});

router.post('/:id/update', function(req, res, next) {
    var engine = req.app.engine;

    var app = engine.apps.getApp(req.params.id);
    if (app === undefined) {
        res.status(404).render('error', { page_title: "ThingEngine - Error",
                                          message: "Not found." });
        return;
    }

    // do something
    Q.try(function() {
        var code = req.body.code;
        var state;
        try {
            // sanity check the app
            var compiler = new AppCompiler();
            compiler.compileCode(code);

            state = JSON.parse(req.body.params);
        } catch(e) {
            res.render('show_app', { page_title: 'ThingEngine App',
                                     name: app.name,
                                     description: app.description || '',
                                     csrfToken: req.csrfToken(),
                                     error: e.message,
                                     code: code,
                                     params: req.body.params });
            return;
        }

        engine.apps.loadOneApp(code, state, req.params.id, app.currentTier, true);
    }).then(function() {
        appsList(req, res, next, "Application successfully created");
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

module.exports = router;
