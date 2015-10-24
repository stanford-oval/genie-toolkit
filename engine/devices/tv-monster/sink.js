// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna
//

const lang = require('lang');
const Q = require('q');
const http = require('http');
const Url = require('url');

const BaseChannel = require('../../base_channel');

const TVMonsterSinkChannel = new lang.Class({
    Name: 'TVMonsterSinkChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this._url = 'http://seo-demo.stanford.edu:3033/add';
    },

    _doOpen: function() {
        return Q();
    },

    _doClose: function() {
        return Q();
    },

    _sendOneUrl: function(url) {
        httpPostAsync(this._url, JSON.stringify({ url: url }), function() {});
    },

    sendEvent: function(event) {
        if (event.urls) {
            for (var i = 0; i < event.urls.length; i++)
                this._sendOneUrl(event.urls[0]);
        } else if (event.url) {
            this._sendOneUrl(event.url);
        } else if (event.youtube) {
            this._sendOneUrl('http://www.youtube.com/v/' + event.youtube);
        } else {
            throw new Error("Event must have url(s) or youtube");
        }
    },
});

function createChannel(engine, device) {
    return new TVMonsterSinkChannel(engine, device);
}

function httpPostAsync(url, data, callback) {
    var options = Url.parse(url);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/json'
    };
    var req = http.request(options, function(res) {
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
