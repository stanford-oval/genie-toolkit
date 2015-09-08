var express = require('express');
var router = express.Router();
const user = require('../util/user');
const db = require('../util/db');

router.get('/', function(req, res, next) {
    if (user.isLoggedIn(req)) {
        res.locals.username = req.session.username;

        db.withClient(function(client) {
            return user.withLogin(req, res, client, function(user) {
                res.render('index',{ 
                    page_title: 'ThingEngine - run your things!',
                    loggedIn: true,
                    cloudId: user.cloud_id,
                    authToken: user.auth_token,
                });
            });
        }).done();

    } else {
        res.locals.username = null;
        
        res.render('index', { 
            page_title: 'ThingEngine - run your things!',
            loggedIn: false 
        });
    }
});

module.exports = router;
