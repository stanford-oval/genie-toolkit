// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const adt = require('adt');
const http = require('http');
const https = require('https');
const tough = require('tough-cookie');
const Url = require('url');

const URL = 'http://pepperjack.stanford.edu';

// mostly copied from Tp.Helpers.Http, with some tweaks to support cookies
// (and also bypassing the proxy, because we don't want stuff to be cached)

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

function httpRequest(url, options) {
    if (!options)
        options = {};

    var parsed = Url.parse(url);
    parsed.method = 'GET';
    parsed.headers = {};
    if (options.auth)
        parsed.headers['Authorization'] = options.auth;
    if (options.accept)
        parsed.headers['Accept'] = options.accept;
    if (options['user-agent'])
        parsed.headers['User-Agent'] = options['user-agent'];
    if (options.cookie)
        parsed.headers['Cookie'] = options.cookie;

    return Q.Promise(function(callback, errback) {
        var req = getModule(parsed).request(parsed, function(res) {
            if (res.statusCode == 302 ||
                res.statusCode == 301) {
                httpRequestStream(res.headers['location'], options).then(callback, errback);
                return;
            }
            if (res.statusCode == 303) {
                httpRequestStream(res.headers['location'], options).then(callback, errback);
                return;
            }
            if (res.statusCode >= 300) {
                var data = '';
                res.setEncoding('utf8');
                res.on('data', function(chunk) {
                    data += chunk;
                });
                res.on('end', function() {
                    console.log('HTTP request failed: ' + data);
                    errback(new Error('Unexpected HTTP error ' + res.statusCode));
                });
                return;
            }

            var cookies;
            if (res.headers['set-cookie']) {
                if (Array.isArray(res.headers['set-cookie']))
                    cookies = res.headers['set-cookie'].map(tough.Cookie.parse);
                else
                    cookies = [tough.Cookie.parse(res.headers['set-cookie'])];
            } else {
                cookies = [];
            }

            var data = '';
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                data += chunk;
            });
            res.on('end', function() {
                callback([data, cookies]);
            });
        });
        req.on('error', function(err) {
            errback(err);
        });
        req.end();
    });
}

class Session {
    constructor(baseUrl) {
        this._baseUrl = baseUrl;
        this._cookieJar = new tough.CookieJar();
    }

    sendUtterance(utterance) {
        return httpRequest(this._baseUrl + '/query?q=' + encodeURIComponent(utterance),
                           { cookie: this._cookieJar.getCookieStringSync(URL) })
            .then((res) => {
                var data = res[0];
                var cookies = res[1];
                cookies.forEach((c) => this._cookieJar.setCookieSync(c, URL, {}));

                var parsed = JSON.parse(data);
                if (parsed.error)
                    throw new Error('Error received from SEMPRE server: ' + parsed.error);

                var candidates = parsed.candidates;
                // for now, just return whatever best candidate we got
                // in the future, we might want to be smarter if we're
                // not confident in a parse
                if (candidates.length > 0)
                    return candidates[0].answer;
                else
                    return null;
            });
    }
}

module.exports = class SempreClient {
    constructor(baseUrl) {
        this._baseUrl = baseUrl || URL;
        this._sessionIds = new Map;
    }

    start() {}
    stop() {}

    openSession() {
        return new Session(this._baseUrl);
    }
}
