// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const http = require('http');
const https = require('https');
const Url = require('url');

module.exports.request = function request(url, method, auth, data, callback) {
    var options = Url.parse(url);
    options.method = method;
    options.headers = {};
    if (method === 'POST')
        options.headers['Content-Type'] = 'application/json';
    if (auth)
        options.headers['Authorization'] = auth;

    var module = options.protocol == 'https:' ? https : http;
    var req = module.request(options, function(res) {
        if (res.statusCode >= 400)
            return callback(new Error(http.STATUS_CODES[res.statusCode]));

        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            data += chunk;
        });
        res.on('end', function() {
            callback(null, data);
        });
    });
    req.on('error', function(err) {
        callback(err);
    });
    req.end(data);
}
