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

var TITLE = "ThingEngine";

var router = express.Router();

router.get('/login', function(req, res, next) {
    req.logout();
    res.render('login', {
        csrfToken: req.csrfToken(),
        errors: req.flash('error'),
        page_title: "ThingEngine - Login"
    });
});


router.post('/login', passport.authenticate('local', { failureRedirect: '/user/login',
                                                       failureFlash: true }),
            function(req, res, next) {
                // Redirection back to the original page
                var redirect_to = req.session.redirect_to ? req.session.redirect_to : '/';
                delete req.session.redirect_to;
                res.redirect(redirect_to);
            });


router.get('/logout', function(req, res, next) {
    req.logout();
    res.redirect('/');
});


module.exports = router;
