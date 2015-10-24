// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const http = require('http');
const Url = require('url');

const BaseChannel = require('../../base_channel');

const POLL_INTERVAL = 30000; // 30s

const TVMonsterSourceChannel = new lang.Class({
    Name: 'TVMonsterSourceChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this._url = 'http://seo-demo.stanford.edu:3033/getNext';
        this._timeout = -1;
    },

    _onTick: function() {
        var channelInstance = this;
        var url = this._url;
        var auth = this._auth;

        return Q.nfcall(httpPostAsync, url, auth).then(function(response) {
            try {
                var parsed = JSON.parse(response);
                channelInstance.emitEvent(parsed);
            } catch(e) {
                console.log('Error parsing TVMonster server response: ' + e.message);
                console.log('Full response was');
                console.log(response);
                return;
            }
        }, function(error) {
            console.log('Error reading from TVMonster server: ' + error.message);
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

function createChannel(engine, state, device) {
    return new TVMonsterSourceChannel(engine, state, device);
}

function httpPostAsync(url, data, callback) {
    var options = Url.parse(url);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/json'
    };
    var req = http.request(options, function(res) {
        if (res.statusCode != 200)
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

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = ['channel-state'];
