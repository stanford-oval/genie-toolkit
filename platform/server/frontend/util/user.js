// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const crypto = require('crypto');

// a model of user based on sharedpreferences
const model = {
    isConfigured: function() {
        var prefs = platform.getSharedPreferences();
        var user = prefs.get('server-login');
        return user !== undefined;
    },

    get: function() {
        var prefs = platform.getSharedPreferences();
        var user = prefs.get('server-login');
        if (user === undefined)
            throw new Error("Login not configured yet");
        return user;
    },

    set: function(username, salt, passwordHash) {
        var prefs = platform.getSharedPreferences();
        var user = { username: username,
                     password: passwordHash,
                     salt: salt };
        prefs.set('server-login', user);
    }
};

function requireLogin(res) {
    res.render('login_required', {
        page_title: "ThingEngine - Login required" 
    });
}

function loggedIn(req, username) {
    req.session.username = username;
}

function makeRandom() {
    return crypto.randomBytes(32).toString('hex');
}

function hashPassword(salt, password) {
    return Q.nfcall(crypto.pbkdf2, password, salt, 10000, 32)
        .then(function(buffer) {
            return buffer.toString('hex');
        });
}

function isLoggedIn(req) {
    return req.session.username !== undefined;
}

module.exports = {
    withLogin: function(req, res, handler) {
        if (!model.isConfigured())
            return handler(undefined);

        var username = req.session.username;

        if (username === undefined)
            return requireLogin(res);
        else
            return handler(model.get())
            .catch(function(error) {
                requireLogin(res);
            });
    },

    isConfigured: function() {
        return model.isConfigured();
    },

    register: function(req, res, username, password) {
        var salt = makeRandom();
        return hashPassword(salt, password)
            .then(function(hash) {
                model.set(username, salt, hash);
                loggedIn(req, username);
                return username;
            });
    },

    login: function(req, res, username, password) {
        return Q.try(function() {
            return model.get();
        }).then(function(user) {
            if (user.username !== username)
                throw new Error("Invalid username or password");

            return hashPassword(user.salt, password)
                .then(function(hash) {
                    if (hash !== user.password)
                        throw new Error("Invalid username or password");

                    loggedIn(req, username);
                    return username;
                });
        });
    },

    logout: function(req) {
        delete req.session.username;
    },

    isLoggedIn: isLoggedIn,

    /* Middleware to check if the user is logged in before performing an
     * action. If not, the user will be redirected to an error page.
     *
     * To be used for POST actions, where redirectLogin would not work.
     */
    requireLogin: function(req, res, next) {
        if (model.isConfigured() && !isLoggedIn(req, res, next)) {
            requireLogin(res);
        } else {
            next();
        }
    },

    /* Middleware to insert user log in page
     * After logging in, the user will be redirected to the original page
     */
    redirectLogin: function(req, res, next) {
        if (model.isConfigured() && !isLoggedIn(req, res, next)) {
            req.session.redirect_to = req.originalUrl;
            res.redirect('/user/login');
        } else {
            next();
        };
    }
};
