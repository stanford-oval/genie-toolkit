// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Url = require('url');
const https = require('https');
const lang = require('lang');
const Q = require('q');

const BaseChannel = require('../../base_channel');

function httpPostAsync(url, auth, data, callback) {
    var options = Url.parse(url);
    options.headers = {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'x-li-format': 'json',
    };
    options.method = 'POST';
    var req = https.request(options, function(res) {
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            data += chunk;
        });
        res.on('end', function() {
            if (res.statusCode != 200)
                return callback(new Error(data));
            else
                callback(null, data);
        });
    });
    req.on('error', function(err) {
        callback(err);
    });
    req.end(data);
}

const LinkedinSinkChannel = new lang.Class({
    Name: 'LinkedinSinkChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this._url = 'https://api.linkedin.com/v1/people/~/shares?format=json';
        this._auth = "Bearer " + device.accessToken;
    },

    sendEvent: function(event) {
        console.log("LinkedinSinkChannel: ", event.message);

        var req = JSON.stringify({ comment: event.comment,
                                   visibility: { code: event.visibility || 'anyone' } });
        httpPostAsync(this._url, this._auth, req, function(err) {
            if (err)
                console.log('Sharing on Linkedin failed: ' + err.message);
        });
    }

});

function createChannel(engine, device) {
    return new LinkedinSinkChannel(engine, device);
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
