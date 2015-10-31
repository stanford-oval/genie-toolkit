// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const events = require('events');

const OAuthUtils = require('./oauth_utils');

module.exports = new lang.Class({
    Name: 'TwitterStream',
    Extends: events.EventEmitter,

    _init: function(twitter) {
        this._twitter = twitter;

        this._connection = null;
        this._dataBuffer = '';
        this._bytesRead = 0;
    },

    _processOneItem: function(payload) {
        if (payload.delete)
            this.emit('delete-tweet', payload.delete);
        else if (payload.scrub_geo || payload.limit || payload.friends ||
                 payload.status_withheld || payload.user_withheld) // ignored
            return;
        else if (payload.disconnect)
            this.close();
        else if (payload.warning)
            console.log('Received warning on Twitter Stream: ' + payload.warning.message);
        else if (payload.event === 'user_update')
            // FIXME update the device with new info
            return;
        else if (payload.event) // ignored
            return;
        else // tweet!
            this.emit('tweet', payload);
    },

    _maybeParseOneItem: function() {
        if (/^(\r\n)+$/.test(this._dataBuffer)) {
            this._dataBuffer = '';
            this._bytesRead = 0;
            return;
        }

        var match = /^(?:\r?\n)*(\d+)\r?\n/.exec(this._dataBuffer);
        if (match === null)
            return;

        // we rely on the fact that we're only matching ASCII chars
        var headerBytes = match[0].length;
        var payloadBytes = this._bytesRead - headerBytes;

        var toRead = parseInt(match[1]);
        if (payloadBytes < toRead)
            return;

        var buffer = this._dataBuffer.substr(headerBytes, toRead);
        this._dataBuffer = this._dataBuffer.substr(headerBytes + toRead);
        this._bytesRead -= headerBytes + toRead;

        try {
            var payload = JSON.parse(buffer);
            this._processOneItem(payload);
        } catch(e) {
            console.log('Failed to parse Twitter streaming chunk: ' + e.message);
            console.log('Full payload was ' + buffer);
        }

        if (this._bytesRead > 0)
            this._maybeParseOneItem(); // tail call
    },

    open: function() {
        if (this._connection)
            return this._connection;

        this._connection = Q.Promise(function(callback, errback) {
            OAuthUtils.performSecureStreamRequest.call(this._twitter.oauth,
                                                       this._twitter.accessToken,
                                                       this._twitter.accessTokenSecret,
                                                       'GET', 'https://userstream.twitter.com/1.1/user.json?delimited=length',
                                                       null, '', null, function(error, data, response) {
                                                           if (error)
                                                               errback(error);
                                                           else
                                                               callback(response);
                                                       });
        }.bind(this)).then(function(response) {
            response.on('data', function(data) {
                this._bytesRead += data.length;
                this._dataBuffer += data.toString('utf8');
                this._maybeParseOneItem();
            }.bind(this));
            response.on('end', function() {
                this._connection = null;
            }.bind(this));

            return response.socket;
        }.bind(this));

        return this._connection;
    },

    close: function() {
        if (!this._connection)
            return Q();

        return this._connection.then(function(sock) { sock.close() });
    }
});
