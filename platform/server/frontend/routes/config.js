var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');
var router = express.Router();

function config(req, res, next, cloud) {
    var host = req.hostname;
    var port = res.app.get('port');
    var serverAddress = 'http://' + host + ':' + port + '/config';

    var prefs = platform.getSharedPreferences();
    var cloudId = prefs.get('cloud-id');
    var authToken = prefs.get('auth-token');

    var qrcodeTarget = 'http://thingpedia.stanford.edu/qrcode/' + host + '/'
        + port + '/' + authToken;

    res.render('config', { page_title: "ThingEngine - run your things!",
                           server: { name: host, port: port,
                                     address: serverAddress,
                                     initialSetup: authToken === undefined },
                           cloud: { configured: cloudId !== undefined,
                                    error: cloud.error,
                                    username: cloud.username,
                                    id: cloudId },
                           qrcodeTarget: qrcodeTarget });
}

router.get('/', function(req, res, next) {
    config(req, res, next, {});
});

function setCloudId(engine, cloudId, authToken) {
    var prefs = platform.getSharedPreferences();
    var oldCloudId = prefs.get('cloud-id');
    if (oldCloudId !== undefined && cloudId !== oldCloudId)
        return false;
    var oldAuthToken = prefs.get('auth-token');
    if (oldAuthToken !== undefined && authToken !== oldAuthToken)
        return false;
    if (oldCloudId === cloudId && authToken === oldAuthToken)
        return true;
    prefs.set('cloud-id', cloudId);
    prefs.set('auth-token', authToken);
    engine._tiers._reopenOne('cloud');
    return true;
}

router.post('/cloud-setup', function(req, res, next) {
    try {
        var username = req.body.username;
        if (!username)
            throw new Error("Missing username");

        var password = req.body.password;
        if (!password)
            throw new Error("Missing password");

        var postData = 'username=' + encodeURIComponent(username)
            + '&password=' + encodeURIComponent(password);

        var request = url.parse('http://thingpedia.stanford.edu:8080/server/login');
        request.method = 'POST';
        request.headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData.length
        };
        var ajax = http.request(request);

        ajax.on('error', function(e) {
            config(req, res, next, { error: e.message,
                                     username: username });
        });
        ajax.on('response', function(response) {
            if (response.statusCode != 200) {
                ajax.abort();
                config(req, res, next, { error: http.STATUS_CODES[response.statusCode],
                                         username: username });
                return;
            }

            var buffer = '';
            response.on('data', function(incoming) {
                buffer += incoming.toString('utf8');
            });
            response.on('end', function() {
                try {
                    var json = JSON.parse(buffer);
                    if (json.success) {
                        setCloudId(res.app.engine, json.cloudId, json.authToken);
                        res.redirect('/config');
                    } else {
                        config(req, res, next, { error: json.error,
                                                 username: username });
                    }
                } catch(e) {
                    config(req, res, next, { error: e.message,
                                             username: username });
                }
            });
        });
        ajax.end(postData);
    } catch(e) {
        config(req, res, next, { error: e.message,
                                 username: username });
    }
});

module.exports = router;
