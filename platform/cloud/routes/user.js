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
var db = require('../util/db');

var TITLE = "ThingEngine";

var EngineManager = require('../enginemanager');

var router = express.Router();

router.get('/oauth2/google', passport.authenticate('google', {
    scope: (['openid','profile','email',
             'https://www.googleapis.com/auth/fitness.activity.read',
             'https://www.googleapis.com/auth/fitness.location.read',
             'https://www.googleapis.com/auth/fitness.body.read']
            .join(' '))
}));
router.get('/oauth2/google/callback', passport.authenticate('google'),
           function(req, res, next) {
               // Redirection back to the original page
               var redirect_to = req.session.redirect_to ? req.session.redirect_to : '/';
               delete req.session.redirect_to;
               res.redirect(redirect_to);
           });

router.get('/oauth2/facebook', passport.authenticate('facebook', {
    scope: 'public_profile email'
}));
router.get('/oauth2/facebook/callback', passport.authenticate('facebook'),
           function(req, res, next) {
               // Redirection back to the original page
               var redirect_to = req.session.redirect_to ? req.session.redirect_to : '/';
               delete req.session.redirect_to;
               res.redirect(redirect_to);
           });


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


router.get('/register', function(req, res, next) {
    res.render('register', {
        csrfToken: req.csrfToken(),
        page_title: "ThingEngine - Register"
    });
});


router.post('/register', function(req, res, next) {
    var username, password;
    try {
        if (typeof req.body['username'] !== 'string' ||
            req.body['username'].length == 0 ||
            req.body['username'].length > 255)
            throw new Error("You must specify a valid username");
        username = req.body['username'];

        if (typeof req.body['password'] !== 'string' ||
            req.body['password'].length < 8 ||
            req.body['password'].length > 255)
            throw new Error("You must specifiy a valid password (of at least 8 characters)");

        if (req.body['confirm-password'] !== req.body['password'])
            throw new Error("The password and the confirmation do not match");
            password = req.body['password']

        } catch(e) {
            res.render('register', {
                csrfToken: req.csrfToken(),
                page_title: "ThingEngine - Register",
                error: e.message
            });
            return;
        }

    return db.withTransaction(function(dbClient) {
        return user.register(dbClient, username, password).then(function(user) {
            return EngineManager.get().startUser(user.id, user.cloud_id, user.auth_token).then(function() {
                return Q.ninvoke(req, 'login', user);
            }).then(function() {
                res.locals.authenticated = true;
                res.locals.user = user;
                res.render('register_success', {
                    page_title: "ThingEngine - Registration Successful",
                    username: username,
                    cloudId: user.cloud_id,
                    authToken: user.auth_token });
            });
        });
    }).catch(function(error) {
        res.render('register', {
            csrfToken: req.csrfToken(),
            page_title: "ThingEngine - Register",
            error: error.message });
    }).done();
});


router.get('/logout', function(req, res, next) {
    req.logout();
    res.redirect('/');
});


module.exports = router;
