var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');
var router = express.Router();

router.get('/', function(req, res, next) {
    var host = req.hostname;
    var port = res.app.get('port');

    var prefs = platform.getSharedPreferences();
    var cloudId = prefs.get('cloud-id');
    var authToken = prefs.get('auth-token');
    res.render('index', { page_title: "ThingEngine - run your things!",
                          server: { name: host, port: port,
                                    initialSetup: authToken === undefined },
                          cloud: { configured: cloudId !== undefined } });
});

module.exports = router;
