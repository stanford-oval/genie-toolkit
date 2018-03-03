// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

const URL = 'https://almond-nl.stanford.edu';

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
        this._locale = locale || 'en_US';
        this._baseUrl = (baseUrl || URL) + '/' + this._locale;

        console.log('Using Almond-NNParser at ' + this._baseUrl);
    }

    onlineLearn(utterance, code) {
        const data = 'q=' + encodeURIComponent(utterance)
            + '&target=' + code.map(encodeURIComponent).join('+');
        Tp.Helpers.Http.post(this._baseUrl + '/learn', data, { dataContentType: 'application/x-www-form-urlencoded' }).then(() => {
            console.log(`Sent "${utterance}" to Almond-NNParser for learning`);
        }).catch((e) => {
            console.error(`Failed to send "${utterance}" to Almond-NNParser for learning: ${e.message}`);
        });
    }

    sendUtterance(utterance, expecting, choices) {
        let url = this._baseUrl + '/query?q=' + encodeURIComponent(utterance);
        if (expecting)
            url += '&expect=' + encodeURIComponent(expecting);
        if (choices) {
            choices.forEach((c, i) => {
                if (c)
                    url += `&choice[${i}]=${encodeURIComponent(c)}`;
            });
        }
        return Tp.Helpers.Http.get(url).then((data) => {
            var parsed = JSON.parse(data);

            if (parsed.error)
                throw new Error('Error received from Almond-NNParser server: ' + parsed.error);

            return parsed;
        });
    }
};
