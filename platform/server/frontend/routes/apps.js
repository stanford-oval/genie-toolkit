var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');
var router = express.Router();

var user = require('../util/user');

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
                              user: { loggedIn: user.isLoggedIn(req) },
                              apps: info });
}

router.get('/', user.redirectLogin, function(req, res, next) {
    appsList(req, res, next, '');
});

router.get('/create', user.redirectLogin, function(req, res, next) {
    res.render('apps_create', { page_title: 'ThingEngine - create app',
                                csrfToken: req.csrfToken(),
                                user: { loggedIn: user.isLoggedIn(req) }
                              });
});

router.post('/create', user.requireLogin, function(req, res, next) {
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
                                              user: { loggedIn: user.isLoggedIn(req) },
                                              message: e.message });
        }).done();
    } catch(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          user: { loggedIn: user.isLoggedIn(req) },
                                          message: e.message });
        return;
    }
});

router.post('/delete', user.requireLogin, function(req, res, next) {
    try {
        var engine = req.app.engine;

        var id = req.body.id;
        var app = engine.apps.getApp(id);
        if (app === undefined) {
            res.status(404).render('error', { page_title: "ThingEngine - Error",
                                              user: { loggedIn: user.isLoggedIn(req) },
                                              message: "Not found." });
            return;
        }

        engine.apps.removeApp(app).then(function() {
            appsList(req, res, next, "Application successfully deleted");
        }).catch(function(e) {
            res.status(400).render('error', { page_title: "ThingEngine - Error",
                                              user: { loggedIn: user.isLoggedIn(req) },
                                              message: e.message });
        }).done();
    } catch(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          user: { loggedIn: user.isLoggedIn(req) },
                                          message: e.message });
        return;
    }
});

function renderApp(appId, jadeView, locals, req, res, next) {
    var jadeOptions = {};
    for (var local in locals)
        jadeOptions[local] = locals[local];
    locals.user = { loggedIn: user.isLoggedIn(req) };
    locals.csrfToken = req.csrfToken();

    // pretend the file is in views/appId/something.jade
    // this allows the app to resolve extends from our UI
    var fakePath = path.join(res.app.get('views'), appId, path.basename(jadeView));
    jadeOptions.cache = true;
    jadeOptions.filename = fakePath;
    fs.readFile(jadeView, function(err, file) {
        if (err)
            return next(err);
        try {
            res.send(jade.render(file, jadeOptions));
        } catch(e) {
            return next(e);
        }
    });
}

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
        renderApp(req.params.id, output[0], output[1], req, res, next);
}

router.get('/show/:id/:command?', user.redirectLogin, function(req, res, next) {
    uiCommand(req, res, next, 'showUI', req.params.command);
});

router.post('/show/:id/:command', user.requireLogin, function(req, res, next) {
    uiCommand(req, res, next, 'postUI', req.params.command);
});

router.initAppRouter = function(engine) {
    engine.apps.getAllApps().forEach(function(app) {
        if (app.filename) {
            var root = path.join(path.dirname(app.filename), 'static');
            this.use('/' + app.uniqueId + '/static', express.static(root));
        }
    }, this);
};

module.exports = router;
