// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const Messaging = require('../../messaging/iface');
const Feed = Messaging.Feed;
const FeedCursor = Messaging.FeedCursor;
const User = Messaging.User;

const OmletUser = new lang.Class({
    Name: 'OmletUser',
    Extends: User,

    _init: function(id, o) {
        this.id = id;
        this.account = o.account;
        this.name = o.name;
    }
});

const OmletFeedCursor = new lang.Class({
    Name: 'OmletFeedCursor',
    Extends: FeedCursor,

    _init: function(feed, db) {
        this.parent(feed);

        this._db = db;
        this._data = db._data.chain().simplesort('serverTimestamp', true).data();
        this._idx = 0;
        this._client = this.feed._device.refOmletClient();
    },

    getValue: function() {
        return this._data[this._idx];
    },

    hasNext: function() {
        return this._idx < this._data.length;
    },

    next: function() {
        return this._data[this._idx++];
    },

    destroy: function() {
        this.feed._device.unrefOmletClient();
        this._client = null;
    },
});

function oinvoke(object, method) {
    var args = Array.prototype.slice.call(arguments, 2);

    return Q.Promise(function(callback, errback) {
        args.push(callback);
        return object[method].apply(object, args);
    });
}

function arrayEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (var i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
}

const OmletFeed = new lang.Class({
    Name: 'OmletFeed',
    Extends: Feed,

    _init: function(messaging, feedId) {
        this.parent(feedId);
        this._messaging = messaging;
        this._device = messaging._device;
        this._client = null;
        this._insertListener = null;
        this._db = null;
        this.ownId = null;

        this._memberList = [];
        this._members = [];
        this.name = null;
    },

    _onInsert: function(o) {
        this.emit('new-message', o);
        if (this.ownId !== o.senderId)
            this.emit('incoming-message', o);
        else
            this.emit('outgoing-message', o);
    },

    _updateMembers: function() {
        if (arrayEqual(this._memberList, this._feed.members))
            return Q();
        this._memberList = this._feed.members;

        var sortedList = new Array(this._memberList.length);
        for (var i = 0, j = 0; i < this._memberList.length; i++) {
            var id = this._memberList[i];
            if (id === this.ownId) {
                sortedList[0] = id;
            } else {
                sortedList[j+1] = id;
                j++;
            }
        }
        return Q.all(sortedList.map(function(m) {
            return this._messaging.getUserById(m);
        }, this)).then(function(users) {
            this._members = users;
        }.bind(this));
    },

    _updateName: function() {
        if (this._feed.name) {
            this.name = this._feed.name;
        } else if (this._memberList.every(function(m) { return m === this.ownId; }, this)) {
            this.name = "You";
        } else {
            this.name = this._members[1].name;
        }
    },

    update: function(feed) {
        this._feed = feed;

        this._updateMembers().then(function() {
            this._updateName();
            this.emit('changed');
        }.bind(this)).done();
    },

    _doOpen: function() {
        console.log('Opening feed with ID ' + this.feedId);

        this._client = this._device.refOmletClient();

        return this._messaging.getOwnId().then(function(ownId) {
            this.ownId = ownId;
            return this._getFeed();
        }.bind(this)).then(function(o) {
            this._feed = o;
            return this._updateMembers();
        }.bind(this)).then(function() {
            this._updateName();
            return oinvoke(this._client.store, 'getFeedObjects', this._client.store.getObjectId(this._feed));
        }.bind(this)).then(function(db) {
            this._db = db;
            this._insertListener = this._onInsert.bind(this);
            this._db._data.on('insert', this._insertListener);
        }.bind(this));
    },

    _doClose: function() {
        this._device.unrefOmletClient();
        this._client = null;

        if (this._insertListener)
            this._db._data.removeListener('insert', this._insertListener);
        this._insertListener = null;
        this._messaging.feedClosed(this.feedId);

        return Q();
    },

    getCursor: function() {
        return new OmletFeedCursor(this, this._db);
    },

    _getFeed: function() {
        return oinvoke(this._client.store, 'getFeeds').then(function(db) {
            return oinvoke(db, 'getObjectByKey', this.feedId);
        }.bind(this)).then(function(o) {
            return o;
        }.bind(this));
    },

    getMembers: function() {
        return this._members;
    },

    sendItem: function(item) {
        var silent = true;
        return Q.ninvoke(this._client.messaging, '_sendObjToFeedImmediate', this._feed, 'text',
                         { text: JSON.stringify(item), silent: silent,
                           hidden: silent });
    },

    sendRaw: function(rawItem) {
        return Q.ninvoke(this._client.messaging, '_sendObjToFeedImmediate', this._feed, rawItem.type,
                         rawItem);
    }
});

module.exports = new lang.Class({
    Name: 'OmletMessaging',
    Extends: Messaging,

    _init: function(device) {
        this._device = device;

        this._feeds = {};
        this._syncclient = null;
    },

    _onFeedRemoved: function(o) {
        delete this._feeds[o.identifier];
    },

    _onFeedChanged: function(o) {
        var feed = this._feeds[o.identifier];
        if (feed)
            feed.update(o);
    },

    feedClosed: function(identifier) {
        delete this._feeds[identifier];
    },

    getFeed: function(feedId) {
        if (feedId in this._feeds)
            return this._feeds[feedId];

        return this._feeds[feedId] = new OmletFeed(this, feedId);
    },

    startSync: function() {
        this._syncclient = this._device.refOmletClient();
        this._syncclient.longdanMessageConsumer.start();

        oinvoke(this._syncclient.store, 'getFeeds').then(function(db) {
            this._feedRemovedListener = this._onFeedRemoved.bind(this);
            this._feedChangedListener = this._onFeedChanged.bind(this);
            db._data.on('delete', this._feedRemovedListener);
            db._data.on('update', this._feedChangedListener);
        }.bind(this)).done();
    },

    stopSync: function() {
        oinvoke(this._syncclient.store, 'getFeeds').then(function(db) {
            db._data.removeListener('delete', this._feedRemovedListener);
            db._data.removeListener('update', this._feedChangedListener);
        }.bind(this)).done();

        this._device.unrefOmletClient();
        this._syncclient = null;
    },

    getOwnId: function() {
        var client = this._device.refOmletClient();
        return oinvoke(client.store, 'getAccounts').then(function(db) {
            return db._data.find({ owned: true }).map(function(o) {
                return client.store.getObjectId(o);
            })[0];
        }).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getUserById: function(id) {
        var client = this._device.refOmletClient();
        return oinvoke(client.store, 'getAccounts').then(function(db) {
            return oinvoke(db, 'getObjectById', id).then(function(o) {
                return new OmletUser(client.store.getObjectId(o), o);
            });
        }).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getAccountById: function(id) {
        var client = this._device.refOmletClient();
        return oinvoke(client.store, 'getAccounts').then(function(db) {
            return oinvoke(db, 'getObjectById', id).then(function(o) {
                return o.account;
            });
        }).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getAccountNameById: function(id) {
        var client = this._device.refOmletClient();
        return oinvoke(client.store, 'getAccounts').then(function(db) {
            return oinvoke(db, 'getObjectById', id).then(function(o) {
                return o.name;
            });
        }).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getFeedList: function() {
        return this.getFeedMetas().then(function(data) {
            return data.map(function(d) {
                return d.identifier;
            });
        });
    },

    getFeedMetas: function() {
        var client = this._device.refOmletClient();
        return oinvoke(client.store, 'getFeeds').then(function(db) {
            return db._data.find().filter(function(f) {
                return f.members.length > 0 &&
                    f.acceptance !== 'Removed';
            });
        }).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    createFeed: function() {
        var client = this._device.refOmletClient();
        return Q.ninvoke(client.feed, 'createFeed').then(function(feed) {
            return new OmletFeed(this, feed.identifier);
        }.bind(this)).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },

    getFeedWithContact: function(contactId) {
        console.log('OmletMessaging.getFeedWithContact');

        var client = this._device.refOmletClient();
        return Q.ninvoke(client.feed, 'getOrCreateFeedWithMembers', [contactId]).then(function(result) {
            console.log('result', result)
            return this.getFeed(result[0].identifier);
        }.bind(this)).finally(function() {
            this._device.unrefOmletClient();
        }.bind(this));
    },
});
