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

function renderApp(appId, jadeView, locals, req, res, next) {
    var jadeOptions = {};
    for (var local in res.locals)
        jadeOptions[local] = res.locals[local];
    jadeOptions.user.loggedIn = true;
    for (var local in locals)
        jadeOptions[local] = locals[local];
    jadeOptions.csrfToken = req.csrfToken();

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

exports.renderApp = renderApp;
