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

    sendEvent: function(event) {
        if (event.url) {
            httpPostAsync(this._url, JSON.stringify({ url: event.url }), function() {});
        } else if (event.youtube) {
            httpPostAsync(this._url, JSON.stringify({ url: 'http://www.youtube.com/v/' + event.youtube }), function() {});
        } else {
            throw new Error("Event must have url or youtube");
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
