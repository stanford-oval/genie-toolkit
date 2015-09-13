// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var Q = require('q');
var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');

var user = require('../util/user');
var appui = require('../../shared/util/appui');
var EngineManager = require('../enginemanager');

var router = express.Router();

function appsList(req, res, next, message) {
    EngineManager.get().getEngine(req.user.id).then(function(engine) {
        return engine.apps.getAllApps();
    }).then(function(apps) {
        return Q.all(apps.map(function(a) {
            return Q.all([a.uniqueId, a.name, a.isRunning, a.isEnabled,
                          a.currentTier])
                .spread(function(uniqueId, name, isRunning, isEnabled, currentTier) {
                    return { uniqueId: uniqueId, name: name || "Some app",
                             running: isRunning, enabled: isEnabled,
                             currentTier: currentTier };
                });
        }));
    }).then(function(appinfo) {
        res.render('apps_list', { page_title: 'ThingEngine - installed apps',
                                  message: message,
                                  csrfToken: req.csrfToken(),
                                  apps: appinfo });
    }).done();
}

router.get('/', user.redirectLogIn, function(req, res, next) {
    appsList(req, res, next, '');
});

router.post('/delete', user.requireLogIn, function(req, res, next) {
    EngineManager.get().getEngine(req.user.id).then(function(engine) {
        var id = req.body.id;
        return engine.apps.getApp(id);
    }).then(function(app) {
        if (app === undefined) {
            res.status(404).render('error', { page_title: "ThingEngine - Error",
                                              message: "Not found." });
            return;
        }

        return engine.apps.removeApp(app);
    }).then(function() {
        appsList(req, res, next, "Application successfully deleted");
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

function uiCommand(req, res, next, call, command) {
    EngineManager.get().getEngine(req.user.id).then(function(engine) {
        return engine.apps.getApp(req.params.id);
    }).then(function(app) {
        if (app === undefined) {
            res.status(404).render('error', { page_title: "ThingEngine - Error",
                                              message: "Not found." });
            return;
        }

        return app[call](command);
    }).then(function(output) {
        if (output === undefined)
            return;

        if (typeof output === 'string')
            res.send(output);
        else
            appui.renderApp(req.params.id, output[0], output[1], req, res, next);
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
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

    if (staticCache[req.user] === undefined)
        staticCache[req.user] = {};

    if (staticCache[req.user][appId] === undefined) {
        var promise = EngineManager.get().getEngine(req.user.id).then(function(engine) {
            return engine.apps.getApp(appId);
        }).then(function(app) {
            if (app !== undefined) {
                return app.filename;
            } else {
                return undefined;
            }
        }).then(function(filename) {
            if (filename !== undefined) {
                var root = path.join(path.dirname(filename), 'static');
                return express.static(root);
            } else {
                return null;
            }
        });
        staticCache[req.user][appId] = promise;
    }

    staticCache[req.user][appId].then(function(middleware) {
        if (middleware !== null)
            middleware(req, res, next);
        else
            res.status(404).render('error', { page_title: "ThingEngine - Error",
                                              message: "Not found." });
    }).done();
});


module.exports = router;
