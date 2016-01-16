// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const BaseChannel = require('./base_channel');
const http = require('http');
const https = require('https');
const Url = require('url');

const PollingTrigger = new lang.Class({
    Name: 'PollingTrigger',
    Extends: BaseChannel,

    _init: function() {
        this.parent();
        this._timeout = null;
    },

    stopPolling: function() {
        clearInterval(this._timeout);
        this._timeout = null;
    },

    _onTick: function() {
        throw new Error('Must override onTick for a PollingTrigger');
    },

    _doOpen: function() {
        this._timeout = setInterval(function() {
            Q(this._onTick()).done();
        }.bind(this), this.interval);
        return this._onTick();
    },

    _doClose: function() {
        this.stopPolling();
        return Q();
    },
});

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

function httpGetAsync(url, auth, callback) {
    var options = Url.parse(url);
    if (auth) {
        options.headers = {
            'Authorization': auth,
        };
    }
    var req = getModule(options).get(options, function(res) {
        if (res.statusCode == 302 ||
            res.statusCode == 301)
            return httpGetAsync(res.headers['location'], auth, callback);
        if (res.statusCode != 200)
            return callback(new Error('Unexpected HTTP error ' + res.statusCode));

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

const HttpPollingTrigger = new lang.Class({
    Name: 'HttpPollingTrigger',
    Extends: PollingTrigger,

    _init: function() {
        this.parent();
        this.url = null;
        this.auth = null;
    },

    _onResponse: function() {
        throw new Error('Must override onResponse for a HttpPollingTrigger');
    },

    _onTick: function() {
        return Q.nfcall(httpGetAsync, this.url, this.auth).then(function(response) {
            return this._onResponse(response);
        }.bind(this)).catch(function(error) {
            console.log('Error reading from upstream server: ' + error.message);
        });
    },
});

const SimpleAction = new lang.Class({
    Name: 'SimpleAction',
    Extends: BaseChannel,

    _doInvoke: function() {
        throw new Error('Must override doInvoke for a SimpleAction');
    },

    sendEvent: function(args) {
        return this._doInvoke.apply(this, args);
    },
});

module.exports = {
    PollingTrigger: PollingTrigger,
    HttpPollingTrigger: HttpPollingTrigger,
};
