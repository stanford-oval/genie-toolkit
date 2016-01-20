// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var Q = require('q');
var express = require('express');
var passport = require('passport');

var user = require('../util/user');
var model = require('../model/user');
var db = require('../util/db');

var TITLE = "ThingEngine";

var EngineManager = require('../enginemanager');

var router = express.Router();

router.get('/', user.redirectLogIn, function(req, res, next) {
    res.render('status', { page_title: "ThingEngine - Status",
                           csrfToken: req.csrfToken(),
                           isRunning: EngineManager.get().isRunning(req.user.id) });
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
        res.status(500).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});


module.exports = router;
