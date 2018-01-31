// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const http = require('http');
const https = require('https');
const Url = require('url');

const URL = 'https://pepperjack.stanford.edu';

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

function httpRequest(url) {
    var parsed = Url.parse(url);
    parsed.method = 'GET';

    return new Promise((callback, errback) => {
        var req = getModule(parsed).request(parsed, (res) => {
            if (res.statusCode === 302 ||
                res.statusCode === 301 ||
                res.statusCode === 303) {
                res.resume();
                httpRequest(res.headers['location']).then(callback, errback);
                return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 300) {
                    console.log('HTTP request failed: ' + data);
                    errback(new Error('Unexpected HTTP error ' + res.statusCode));
                } else {
                    callback(data);
                }
            });
        });
        req.on('error', errback);
        req.end();
    });
}

module.exports = class ParserClient {
    constructor(baseUrl, locale) {
        this._baseUrl = baseUrl || URL;
        this._locale = locale || 'en_US';
        this._sessionId = undefined;

        console.log('Using Almond-NNParser at ' + this._baseUrl + ' with locale ' + this._locale);
    }

    onlineLearn(utterance, code) {
        var url = this._baseUrl + '/learn?locale=' + this._locale + '&q=' + encodeURIComponent(utterance)
            + '&sessionId=' + this._sessionId + '&target=' + encodeURIComponent(code.join(','));
        httpRequest(url).then(() => {
            console.log('Sent "' + utterance + '" to Almond-NNParser for learning');
        }).catch((e) => {
            console.error('Failed to send "' + utterance + '" to Almond-NNParser for learning: ' + e.message);
        }).done();
    }

    sendUtterance(utterance, expecting, choices) {
        var url = this._baseUrl + '/query?locale=' + this._locale + '&limit=20&q=' + encodeURIComponent(utterance);
        if (this._sessionId)
            url += '&sessionId=' + this._sessionId;
        if (expecting)
            url += '&expect=' + encodeURIComponent(expecting);
        if (choices) {
            choices.forEach((c, i) => {
                if (c)
                    url += `&choice[${i}]=${encodeURIComponent(c)}`;
            });
        }
        return httpRequest(url).then((data) => {
            var parsed = JSON.parse(data);
            this._sessionId = parsed.sessionId;

            if (parsed.error)
                throw new Error('Error received from Almond-NNParser server: ' + parsed.error);

            return parsed;
        });
    }
};
