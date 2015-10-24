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

    _sendYT: function(yt) {
        httpPostAsync(this._url + '/yt/' + encodeURIComponent(yt), function() {});
    },

    _sendRaw: function(raw) {
        httpPostAsync(this._url + '/raw/' + encodeURIComponent(raw), function() {});
    },

    sendEvent: function(event) {
        if (event.url) {
            if (event.url.startsWith('http://www.youtube.com/v/'))
                this._sendYT(event.url.substr('http://www.youtube.com/v/'.length));
            else if (event.url.startsWith('http://www.youtube.com/watch?v='))
                this._sendYT(event.url.substr('http://www.youtube.com/watch?v='.length));
            else
                this._sendRaw(event.url);
        } else if (event.youtube) {
            this._sendYT(event.youtube);
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
