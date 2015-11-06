// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Jiaqi Xue <jiaqixue@stanford.edu>
//

const lang = require('lang');
const Q = require('q');
const https = require('https');
const Url = require('url');

const BaseChannel = require('../../base_channel');

const POLL_INTERVAL = 86400 * 1000; // 1 day

const LinkedInSourceChannel = new lang.Class({
    Name: 'LinkedInSourceChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this._url = 'https://api.linkedin.com/v1/people/~:(id,formatted-name,headline,industry,specialties,positions,picture-url)?format=json'
        this._auth = "Bearer " + device.accessToken;
        this._timeout = -1;
    },

    _onTick: function() {
        var channelInstance = this;
        var url = this._url;
        var auth = this._auth;

        return Q.nfcall(httpGetAsync, url, auth).then(function(response) {
            console.log('response', response);
            this.emitEvent(JSON.parse(response));
        }.bind(this)).catch(function(error) {
            console.log('Error reading from LinkedIn server: ' + error.message);
        });
    },

    _doOpen: function() {
        this._timeout = setInterval(function() {
            this._onTick().done();
        }.bind(this), POLL_INTERVAL);
        return this._onTick();
    },

    _doClose: function() {
        clearInterval(this._timeout);
        this._timeout = -1;
        return Q();
    }
});

function createChannel(engine, device) {
    return new LinkedInSourceChannel(engine, device);
}

function httpGetAsync(url, auth, callback) {
    var options = Url.parse(url);
    options.headers = {
        'Authorization': auth,
    };
    var req = https.get(options, function(res) {
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
}

module.exports.createChannel = createChannel;
