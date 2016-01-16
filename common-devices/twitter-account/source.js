// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');
const Q = require('q');

const TwitterStream = require('./stream');

function rep(x, n) {
    return Array(n).map(function() {
        return x;
    }).join('');
}

module.exports = new Tp.ChannelClass({
    Name: 'TwitterSourceChannel',
    RequiredCapabilities: ['channel-state'],

    _init: function(engine, state, device) {
        this.parent();

        this.device = device;
        this._state = state;
        this._twitter = device.queryInterface('twitter');
        this._stream = null;
    },

    _processOneTweet: function(tweet) {
        var idStr = tweet.id_str;
        var sinceId = this._state.get('since_id');
        var padIdStr, padSinceId;

        if (idStr === undefined) {
            console.log('Missing id_str in Tweet?');
            console.log(tweet);
            return;
        }

        if (sinceId === undefined)
            sinceId = '0';

        // both are strings, and need to stay strings (JS doesn't do 64-bit numbers)
        // so we pad them with 0s and compare lexicographically
        if (idStr.length < sinceId.length) {
            padIdStr = rep('0', sinceId.length - idStr.length) + idStr;
            padSinceId = sinceId;
        } else if (idStr.length > sinceId.length) {
            padSinceId = rep('0', idStr.length - sinceId.length) + sinceId;
            padIdStr = idStr;
        }

        if (padSinceId > padIdStr)
            return;

        this._state.set('since_id', idStr);

        var hashtags = [];
        for (var i = 0; i < tweet.entities.hashtags.length; i++) {
            hashtags.push(tweet.entities.hashtags[i].text);
        }

        var urls = [];
        for (var i = 0; i < tweet.entities.urls.length; i++) {
            urls.push(tweet.entities.urls[i].expanded_url);
        }

        var event = [tweet.text,
                     hashtags,
                     urls,
                     tweet.user.screen_name,
                     tweet.in_reply_to_screen_name,
                     tweet.user.screen_name === this.device.screenName];
        this.emitEvent(event);
    },

    _onPollTick: function() {
        var channelInstance = this;
        var twitter = this._twitter;

        return Q.Promise(function(callback, errback) {
            var since_id = this._state.get('since_id');
            return twitter.getHomeTimeline({ since_id: since_id, count: 200 }, errback, callback);
        }.bind(this)).then(function(results) {
            results = JSON.parse(results);
            for (var i = results.length-1; i >= 0; i--) {
                this._processOneTweet(results[i]);
            }
        }.bind(this)).catch(function(e) {
            console.log('Failed to poll Twitter for new data: ' + e);
            console.log(e.stack);
        });
    },

    _startStreaming: function() {
        this._stream = new TwitterStream(this._twitter);
        this._stream.on('tweet', this._processOneTweet.bind(this));
        return this._stream.open();
    },

    _doOpen: function() {
        // poll for old data, then setup stream
        this._onPollTick().then(function() {
            return this._startStreaming();
        }.bind(this)).catch(function(e) {
            console.log('Failed to start streaming Twitter', e);
        }).done();

        return Q();
    },

    _stopStreaming: function() {
        this._stream.close();
        this._stream = null;
    },

    _doClose: function() {
        if (this._stream)
            return this._stopStreaming();
        else
            return Q();
    }
});

