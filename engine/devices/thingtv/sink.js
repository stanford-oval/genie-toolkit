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

const ThingTVChannel = new lang.Class({
    Name: 'ThingTVChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this._url = 'http://' + device.host + ':' + device.port + '/api/switch-to';
    },

    _doOpen: function() {
        return Q();
    },

    _doClose: function() {
        return Q();
    },

    sendEvent: function(event) {
        if (event.url) {
            if (event.url.startsWith('http://www.youtube.com/v/'))
                httpPostAsync(this._url + '/yt/' + encodeURIComponent(event.url.substr('http://www.youtube.com/v/'.length)), function() {});
            else
                httpPostAsync(this._url + '/raw/' + encodeURIComponent(event.url), function() {});
        } else if (event.youtube) {
            httpPostAsync(this._url + '/yt/' + encodeURIComponent(event.youtube), function() {});
        } else {
            throw new Error("Event must have url or youtube");
        }
    },
});

function createChannel(engine, device) {
    return new ThingTVChannel(engine, device);
}

function httpPostAsync(url, callback) {
    var options = Url.parse(url);
    options.method = 'POST';
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
    req.end();
}

module.exports.createChannel = createChannel;
