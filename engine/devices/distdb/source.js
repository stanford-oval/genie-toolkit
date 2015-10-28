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

        this._device = device;
        this._feedId = device.feedId;
        this._feed = null;
        this._members = null;
        this._listener = null;
    },

    _readCurrent: function(feed, members) {
        return feed.getCursor().then(function(cursor) {
            console.log('Obtained Messaging cursor');
            var memberToValueMap = [];
            var nmembers = members.length;

            function loop() {
                return cursor.hasNext().then(function(hasNext) {
                    console.log('Cursor has next value: ' + hasNext);
                    if (!hasNext)
                        return memberToValueMap;
                    else
                        return cursor.next().then(function(obj) {
                            console.log('Cursor next value is a ' + typeof obj);
                            console.log('Cursor next value: ' + JSON.stringify(obj));
                            var sender = obj.sender;
                            var payload = obj.payload;
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
                                    return memberToValueMap;
                                }
                            }

                            return loop();
                        });
                });
            }

            return loop().finally(function() {
                console.log('Done using cursor');
                return cursor.destroy();
            });
        }).then(function(memberToValueMap) {
            var array = Object.keys(memberToValueMap)
                .filter(function(k) { return memberToValueMap[k] !== null; })
                .map(function(k) { return memberToValueMap[k]; });
            console.log('Computed final database event: ' + array);
            this.emitEvent(array);
        }.bind(this));
    },

    _onChange: function() {
        this._readCurrent().done();
    },

    _doOpen: function() {
        var messagingDevice = this._device.getMessagingDevice();
        if (messagingDevice === undefined)
            throw new Error('Messaging account must be configured before using distdb');
        var messaging = messagingDevice.queryInterface('messaging')
        if (messaging === null)
            throw new Error('Messaging account lacks messaging interface?');

        this._feed = messaging.getFeed(this._feedId);
        return feed.open().then(function() {
            console.log('Successfully opened Omlet feed');
            return this._feed.getMembers();
        }.bind(this)).then(function(members) {
            console.log('Obtained list of members: ' + members);
            this._members = members;
            return this._readCurrent(this._feed, members);
        }.bind(this)).then(function() {
            this._listener = this._onChange.bind(this);
            this._feed.on('change', this._listener);
            return this._feed.startWatch();
        });
    },

    _doClose: function() {
        if (this._listener) {
            this._feed.removeListener('change', this._listener);
            this._listener = null;

            return this._feed.stopWatch().then(function() {
                return this._feed.close();
            });
        } else {
            return this._feed.close();
        }
    }
});

function createChannel() {
    return new DistributedDatabaseSourceChannel();
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
