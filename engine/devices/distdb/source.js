// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseChannel = require('../../base_channel');

const DistributedDatabaseSourceChannel = new lang.Class({
    Name: 'DistributedDatabaseSourceChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this.engine = engine;
        this._device = device;
        this._feedId = device.feedId;
        this._feed = null;
        this._members = null;
        this._listener = null;
    },

    _readCurrent: function(feed, members) {
        var memberToValueMap = [];
        var nmembers = members.length;
        var cursor = feed.getCursor();

        try {
            console.log('Obtained Messaging cursor');
            while (cursor.hasNext()) {
                var obj = cursor.next();

                console.log('Cursor next value is a ' + typeof obj);
                console.log('Cursor next value: ' + JSON.stringify(obj));
                var sender = obj.senderId;
                var payload = obj.body;
                if (!(sender in memberToValueMap)) {
                    console.log('Found new value for ' + sender);
                    try {
                        var parsed = JSON.parse(payload);
                        parsed.sender = sender;
                        memberToValueMap[sender] = parsed;
                    } catch(e) {
                        console.log('Failed to parse payload: ' + e.message);
                        memberToValueMap[sender] = null;
                    }
                    nmembers--;
                    if (nmembers == 0) {
                        console.log('Found a value for all members, done');
                        break;
                    }
                }
            }
        } finally {
            console.log('Done using cursor');
            cursor.destroy();
        }

        var array = Object.keys(memberToValueMap)
            .filter(function(k) { return memberToValueMap[k] !== null; })
            .map(function(k) { return memberToValueMap[k]; });
        console.log('Computed final database event: ' + array);
        this.emitEvent(array);
    },

    _onChange: function() {
        this._readCurrent().done();
    },

    _doOpen: function() {
        this._feed = this.engine.messaging.getFeed(this._feedId);
        return feed.open().then(function() {
            console.log('Successfully opened Omlet feed');
            return this._feed.getMembers();
        }.bind(this)).then(function(members) {
            console.log('Obtained list of members: ' + members);
            this._members = members;
            return this._readCurrent(this._feed, members);
        }.bind(this)).then(function() {
            this._listener = this._onChange.bind(this);
            this._feed.on('new-message', this._listener);
        });
    },

    _doClose: function() {
        if (this._listener) {
            this._feed.removeListener('new-message', this._listener);
            this._listener = null;
        }

        return this._feed.close();
    }
});

function createChannel() {
    return new DistributedDatabaseSourceChannel();
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
