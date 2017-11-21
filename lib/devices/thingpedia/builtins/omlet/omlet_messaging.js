// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
//
// Copyright 2015-2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const Tp = require('thingpedia');

// GIANT HACK
const LDProto = require('omlib/src/longdan/ldproto');
const RawIdentity = require('omlib/src/client/model/RawIdentity');

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

class OmletUser {
    constructor(id, o) {
        this.id = id;
        this.account = o.account;
        this.name = o.name;
        this.thumbnail = o.thumbnailHash;
    }
}

class OmletFeed extends Tp.Messaging.Feed {
    constructor(messaging, feedId) {
        super(feedId);

        this._messaging = messaging;
        this._device = messaging._device;
        this._insertListener = null;
        this._db = null;
        this.ownAccount = this._messaging.account;

        this._lastMessage = 0;
    }

    _newMessage(o) {
        if (o.serverTimestamp < this._lastMessage)
            return;
        this._lastMessage = o.serverTimestamp;
        this.emit('new-message', o);
        if (this.ownAccount !== o.sender)
            this.emit('incoming-message', o);
        else
            this.emit('outgoing-message', o);
    }

    update(feed) {
        this._feed = feed;
        this.emit('changed');
    }

    _doOpen() {
        //console.log('Opening feed with ID ' + this.feedId);

        this._client = this._device.refOmletClient();

        return this._getFeed().then((o) => {
            this._feed = o;
        });
    }

    _doClose() {
        this._device.unrefOmletClient();
        this._client = null;

        if (this._insertListener)
            this._db._data.removeListener('insert', this._insertListener);
        this._insertListener = null;
        this._messaging.feedClosed(this.feedId);

        return Q();
    }

    _getFeed() {
        return oinvoke(this._client.store, 'getFeeds')
        .then((db) => oinvoke(db, 'getObjectByKey', this.feedId));
    }

    sendText(text) {
        return Q.ninvoke(this._client._ldClient.messaging, '_sendObjToFeed', this._feed, 'text',
                         { text: text });
    }

    sendPicture(url) {
        if (typeof url === 'string') {
            if (url.startsWith('http')) {
                return Tp.Helpers.Http.get(url, { raw: true }).spread(function(data, contentType) {
                    return Q.ninvoke(this._client._ldClient.messaging, '_pictureObjFromBytes', data, contentType);
                }.bind(this)).spread(function(objType, obj) {
                    return Q.ninvoke(this._client._ldClient.messaging, '_sendObjToFeed',
                                     this._feed, objType, obj);
                }.bind(this));
            } else {
                return Tp.Helpers.Content.getStream(this._device.engine.platform, url).then((stream) => {
                    var contentType = stream.contentType;
                    return Q.Promise(function(callback, errback) {
                        var buffers = [];
                        var length = 0;

                        stream.on('data', (buffer) => {
                            buffers.push(buffer);
                            length += buffer.length;
                        });
                        stream.on('end', () => {
                            callback(Buffer.concat(buffers, length));
                        });
                        stream.on('error', errback);
                    }).then((data) => {
                        console.log('data', data);
                        return Q.ninvoke(this._client._ldClient.messaging, '_pictureObjFromBytes', data, contentType);
                    });
                }).spread((objType, obj) => {
                    return Q.ninvoke(this._client._ldClient.messaging, '_sendObjToFeed',
                                     this._feed, objType, obj);
                });
            }
        } else if (Buffer.isBuffer(url)) {
            return Q.ninvoke(this._client.messaging, '_pictureObjFromBytes', url)
                .spread(function(objType, obj) {
                    return Q.ninvoke(this._client.messaging, '_sendObjToFeed',
                                     this._feed, objType, obj);
                }.bind(this));
        } else {
            throw new TypeError('Invalid type for call to sendPicture, must be string or buffer');
        }
    }

    sendItem(item) {
        var silent = true;
        return Q.ninvoke(this._client._ldClient.messaging, '_sendObjToFeed', this._feed, 'text',
                         { text: JSON.stringify(item), silent: silent,
                           hidden: silent });
    }

    sendRaw(rawItem) {
        return Q.ninvoke(this._client._ldClient.messaging, '_sendObjToFeed', this._feed, rawItem.type,
                         rawItem);
    }
}

class ChatObjectProcessor {
    constructor(messaging) {
        this._messaging = messaging;
    }

    processMessage(client, db, feed, sender, msg, receipt) {
        if (receipt.type) {
            // duplicate message, ignore
            return;
        }

        var t = Math.round(msg.Timestamp / 1000);
        console.log('New message length ' + msg.Body.length);
        var body = JSON.parse(msg.Body);
        console.log('Body: ' + String(body.text));
        body.type = msg.Id.Type;
        body.serverTimestamp = t;
        body.sender = msg.Owner;
        body.msgId = client.store.getObjectId(receipt);

        var feedId = feed.identifier;
        if (this._messaging._feeds[feedId])
            this._messaging._feeds[feedId]._newMessage(body);

        this._messaging._newMessage(feed.identifier, body);
    }
}

module.exports = class Messaging extends Tp.Messaging {
    constructor(device) {
        super();
        this._device = device;
        this._device._chatObjectProcessor = new ChatObjectProcessor(this);
        this._feeds = {};
        this.client = null;
    }

    _newMessage(feedId, msg) {
        if (this.account !== msg.sender)
            this.emit('incoming-message', feedId, msg);
        else
            this.emit('outgoing-message', feedId, msg);
    }

    get account() {
        return this.client.auth.getAccount();
    }

    getIdentities() {
        return (this.client._ldClient._details.Identities || []).map((id) => id.Type + ':' + id.Principal);
    }

    _onFeedRemoved(o) {
        this.emit('feed-removed', o.identifier);
        delete this._feeds[o.identifier];
    }

    _onFeedChanged(o) {
        var feed = this._feeds[o.identifier];
        if (feed)
            feed.update(o);
        this.emit('feed-changed', o.identifier);
    }

    _onFeedAdded(o) {
        this.emit('feed-added', o.identifier);
    }

    feedClosed(identifier) {
        console.log('Closed feed ' + identifier);
        delete this._feeds[identifier];
    }

    getFeed(feedId) {
        if (feedId in this._feeds)
            return this._feeds[feedId];

        return this._feeds[feedId] = new OmletFeed(this, feedId);
    }

    start() {
        this.client = this._device.refOmletClient();

        return oinvoke(this.client.store, 'getFeeds').then(function(db) {
            this._feedRemovedListener = this._onFeedRemoved.bind(this);
            this._feedChangedListener = this._onFeedChanged.bind(this);
            this._feedAddedListener = this._onFeedAdded.bind(this);
            db._data.on('delete', this._feedRemovedListener);
            db._data.on('update', this._feedChangedListener);
            db._data.on('insert', this._feedAddedListener);
        }.bind(this)).then(function() {
            return this.getOwnId();
        }.bind(this)).then(function(ownId) {
            this.ownId = ownId;
        }.bind(this));
    }

    stop() {
        return oinvoke(this.client.store, 'getFeeds').then(function(db) {
            db._data.removeListener('delete', this._feedRemovedListener);
            db._data.removeListener('update', this._feedChangedListener);
            db._data.removeListener('insert', this._feedAddedListener);

            this._device.unrefOmletClient();
            this.client = null;
        }.bind(this));
    }

    getOwnId() {
        return oinvoke(this.client.store, 'getAccounts').then(function(db) {
            return db._data.find({ owned: true }).map(function(o) {
                return this.client.store.getObjectId(o);
            }, this)[0];
        }.bind(this));
    }

    getUserByAccount(account) {
        return oinvoke(this.client._ldClient.identity, 'ensureIdentity', { account: account }).then(() => {
            return oinvoke(this.client.store, 'getAccounts');
        }).then((db) => {
            return oinvoke(db, 'getObjectByKey', account);
        }).then((o) => {
            if (!o)
                return null;
            return new OmletUser(this.client.store.getObjectId(o), o);
        });
    }

    getBlobDownloadLink(blobHash) {
        const blob = this.client._ldClient.blob;
        return Q.ninvoke(blob, 'getDownloadLinkForHash', blobHash);
    }

    getFeedList() {
        return oinvoke(this.client.store, 'getFeeds').then(function(db) {
            var data = db._data.find();
            return data.map(function(d) {
                return d.identifier;
            });
        }.bind(this));
    }

    createFeed() {
        return Q.ninvoke(this.client.feeds, 'createFeed').then(function(feed) {
            return new OmletFeed(this, feed.identifier);
        }.bind(this));
    }

    searchAccountByName(name) {
        return oinvoke(this.client.store, 'getAccounts').then((db) => {
            return db._data.where(doc => doc.name.toLowerCase().indexOf(name) >= 0 && !doc.owned);
        });
    }

    addAccountToContacts(contactId) {
        return oinvoke(this.client._ldClient.identity, '_addAccountToContacts', contactId);
    }

    getFeedWithContact(contactId) {
        return Q.try(() => {
            if (contactId.indexOf(':') < 0)
                return this.addAccountToContacts(contactId);
        }).then(() => {
            return Q.ninvoke(this.client.feeds, 'getOrCreateFeedWithAccounts', [contactId]);
        }).spread((feed, existing) => {
                if (existing)
                    console.log('Reusing feed ' + feed.identifier + ' with ' + contactId);
                else
                console.log('Created feed ' + feed.identifier + ' with ' + contactId);
            return this.getFeed(feed.identifier);
        });
    }

    getAccountForIdentity(identity) {
        var identityHash = RawIdentity.parse(identity).getEncodedHashedIdentity();
        return oinvoke(this.client._ldClient.identity, 'getAccountsForIdentityHashes', [identityHash]).then(function(matches) {
            if (matches.length > 0)
                return matches[0];
            else
                return null;
        }.bind(this));
    }

    leaveFeed(feedId) {
        return oinvoke(this.client.store, 'getFeeds').then(function(db) {
            return oinvoke(db, 'getObjectByKey', feedId).then(function(feed) {
                var ldFeed = this.client._ldClient.feed.getLDFeed(feed);
                var account = this.client.auth.getAccount();
                var req = new LDProto.LDRemoveMemberRequest();
                req.Feed = ldFeed;
                req.Member = account;
                return Q.Promise(function(callback, errback) {
                    return this.client._ldClient._msg.call(req, function(err, resp) {
                        if (err)
                            errback(err);
                        else
                            callback();
                    }.bind(this));
                }.bind(this)).then(function() {
                    // GIANT GIANT GIANT HACK
                    // omclient does not process feed membership changes
                    // in a sensible manner
                    // so we just delete the feed manually here
                    db._data.remove(feed);
                });
            }.bind(this));
        }.bind(this));
    }
}

