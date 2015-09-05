var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');
var router = express.Router();

router.get('/', function(req, res, next) {
    var engine = req.app.engine;

    var apps = engine.apps.getAllApps();
    var info = apps.map(function(a) {
        return { uniqueId: a.uniqueId, name: a.name || "Some app",
                 running: a.isRunning, enabled: a.isEnabled };
    });

    res.render('apps_list', { page_title: 'ThingEngine - installed apps',
                              apps: info });
});

router.get('/create', function(req, res, next) {
    res.render('apps_create', { page_title: 'ThingEngine - create app' });
});

router.post('/create', function(req, res, next) {
    try {
        var parsed = JSON.parse(req.body['json-blob']);
        var tier = req.body.tier;
        if (tier !== 'server' && tier !== 'cloud' && tier !== 'phone')
            throw new Error('No such tier ' + tier);

        var engine = req.app.engine;

        engine.apps.loadOneApp(parsed, tier, true).then(function() {
            res.redirect('/apps');
        }).catch(function(e) {
            res.status(e).send('<!DOCTYPE html><title>ThingEngine</title>'
                               +'<p>' + e.message + '</p>');
        }).done();
    } catch(e) {
        // XSS!
        // lol
        res.status(e).send('<!DOCTYPE html><title>ThingEngine</title>'
                           +'<p>' + e.message + '</p>');
        return;
    }
});

router.get('/delete/:id', function(req, res, next) {
    try {
        var engine = req.app.engine;

        var app = engine.apps.getApp(req.params.id);
        if (app === undefined) {
            res.status(404).send('<!DOCTYPE html><title>ThingEngine</title>'
                                 +'<p>Not found.</p>');
            return;
        }

        engine.apps.removeApp(app).then(function() {
            res.redirect('/apps');
        }).catch(function(e) {
            res.status(400).send('<!DOCTYPE html><title>ThingEngine</title>'
                               +'<p>' + e.message + '</p>');
        }).done();
    } catch(e) {
        // XSS!
        // lol
        res.status(400).send('<!DOCTYPE html><title>ThingEngine</title>'
                           +'<p>' + e.message + '</p>');
        return;
    }
});

function renderApp(appId, jadeView, locals, res, next) {
    var jadeOptions = {};
    for (var local in locals)
        jadeOptions[local] = locals[local];

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
        res.status(404).send('<!DOCTYPE html><title>ThingEngine</title>'
                             +'<p>Not found.</p>');
        return;
    }

    var output = app[call](command);
    if (typeof output === 'string')
        res.send(output);
    else
        renderApp(req.params.id, output[0], output[1], res, next);
}

router.get('/:id/:command?', function(req, res, next) {
    uiCommand(req, res, next, 'showUI', req.params.command);
});

router.post('/:id/:command', function(req, res, next) {
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
