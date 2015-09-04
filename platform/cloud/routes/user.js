var express = require('express');
var model = require('../model/user');
var router = express.Router();
var user = require('../util/user');
var db = require('../util/db');

var TITLE = "ThingEngine";

var EngineManager = require('../enginemanager');

router.get('/login', function(req, res, next) {
    user.logout(req);
    res.render('login', {
        csrfToken: req.csrfToken(), 
        page_title: "ThingEngine - Login" 
    });
});


router.post('/login', function(req, res, next) {
    db.withClient(function(client) {
        return user.login(req, res, client, req.body['username'], req.body['password'])
        .then(function() {
            // Redirection back to the original page
            var redirect_to = req.session.redirect_to ? req.session.redirect_to : '/';
            delete req.session.redirect_to;

            res.redirect(redirect_to);
        });
    }).catch(function(error) {
        res.render('login', { 
            csrfToken: req.csrfToken(), 
            page_title: "ThingEngine - Login",
            error: error.message,
            username: req.body['username'], 
            password: req.body['password'] 
        });
    });
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
            password = req.body['password'];     

        } catch(e) {         
            res.render('register', {
                csrfToken: req.csrfToken(), 
                page_title: "ThingEngine - Register",
                error: e.message 
            });
            return;     
        }

    db.withTransaction(function(client) {
        return user.register(req, res, client, username, password).spread(function(userId, cloudId, authToken) {
            return EngineManager.get().startUser(userId, cloudId, authToken)
                .then(function() {
                    res.render('register_success', { 
                        page_title: "ThingEngine - Registration Successful",
                        username: username,
                        cloudId: cloudId,
                        authToken: authToken });
                });
        });

    }).catch(function(error) {
        res.render('register', { 
            csrfToken: req.csrfToken(), 
            page_title: "ThingEngine - Register",
            error: error.message });
    });
});

module.exports = router;
