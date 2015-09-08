var express = require('express');
var router = express.Router();
var user = require('../util/user');

var TITLE = "ThingEngine";

router.get('/login', function(req, res, next) {
    user.logout(req);
    res.render('login', {
        csrfToken: req.csrfToken(),
        user: { loggedIn: false },
        page_title: "ThingEngine - Login"
    });
});

router.post('/login', function(req, res, next) {
    user.login(req, res, req.body['username'], req.body['password'])
        .then(function() {
            // Redirection back to the original page
            var redirect_to = req.session.redirect_to ? req.session.redirect_to : '/';
            delete req.session.redirect_to;

            res.redirect(redirect_to);
        })
        .catch(function(error) {
            res.render('login', {
                csrfToken: req.csrfToken(),
                user: { loggedIn: false },
                page_title: "ThingEngine - Login",
                error: error.message,
                username: req.body['username'],
                password: ''
            });
        }).done();
});

router.get('/logout', function(req, res, next) {
    user.logout(req);
    req.session.redirect_to = '/';
    res.redirect('/user/login');
});

module.exports = router;
