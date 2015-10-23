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

const TwitterSinkChannel = new lang.Class({
    Name: 'TwitterSinkChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this._twitter = device.queryInterface('twitter');
    },

    _doOpen: function() {
        return Q();
    },

    _doClose: function() {
        return Q();
    },

    sendEvent: function(event) {
        console.log('Posting Twitter event', event);
        if (event.status) {
            this._twitter.postTweet({ status: event.status,
                                      in_reply_to_status_id: event.inReplyTo }, function(err) {
                                          console.log('Tweeting failed: ' + err);
                                      }, function() { });
        } else {
            throw new Error("Event must have url or youtube");
        }
    },
});

function createChannel(engine, device) {
    return new TwitterSinkChannel(engine, device);
}

module.exports.createChannel = createChannel;
