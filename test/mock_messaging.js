// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const Tp = require('thingpedia');

let msgId = 0;

class Feed extends Tp.Messaging.Feed {
    constructor(feedId, members, parent) {
        super(feedId);
        this._messages = [];

        this._members = members;
        this._parent = parent;
    }

    async _doOpen() {}
    async _doClose() {}

    getMembers() {
        return this._members;
    }

    _sendMessage(from, msg) {
        setImmediate(() => {
            msg.sender = from;
            msg.serverTimestamp = Date.now();
            msg.msgId = 'msg:' + msgId++;

            this._messages.push(from, msg);
            this.emit('new-message', msg);
            const direction = from === 'user1' ? 'outgoing-message' : 'incoming-message';
            this.emit(direction, msg);
            this._parent.emit(direction, this.feedId, msg);
        });
    }

    sendText(text) {
        this._sendMessage('user1', {
            type: 'text',
            text
        });
    }
    sendPicture(url) {
        this._sendMessage('user1', {
            type: 'picture',
            url
        });
    }
    sendItem(json) {
        this._sendMessage('user1', {
            type: 'app',
            json
        });
    }
}

class MockUser {
    constructor(account, name) {
        this.account = account;
        this.name = name;
        this.thumbnail = account + '.png';
    }
}

// a mock messaging class that "routes" messages only within this process
module.exports = class MockMessaging extends Tp.Messaging {
    constructor() {
        super();
        this._feeds = [
            new Feed('feed1', ['user1', 'user2'], this),
            new Feed('feed2', ['user3', 'user1'], this)
        ];
    }

    get type() {
        return 'mock';
    }

    get account() {
        return 'user1';
    }

    get isAvailable() {
        return true;
    }

    getIdentities() {
        return ['phone:+1555123456', 'email:bob@example.com'];
    }

    async start() {
    }
    async stop() {
    }

    async getFeedList() {
        return this._feeds;
    }

    getFeed(feedId) {
        let feed = this._feeds.find((f) => f.feedId === feedId);
        if (feed)
            return feed;

        feed = new Feed(feedId, ['user1'], this);
        this._feeds.push(feed);
        this.emit('feed-added', feed);
        return feed;
    }

    async getFeedByAlias(alias) {
        return this.getFeed(alias);
    }

    async getFeedWithContact(contactIds) {
        assert.deepStrictEqual(contactIds.length, 1);
        let contactId = contactIds[0];

        assert(!contactId.startsWith('mock-account:'));
        assert(!contactId.startsWith('matrix-account:'));
        assert(contactId !== 'user1');

        switch (contactId) {
        case 'user2':
            return this.getFeed('feed1');
        case 'user3':
            return this.getFeed('feed2');
        default: {
            const feed = new Feed('feed' + (this._feeds.length+1), ['user1', contactId], this);
            this._feeds.push(feed);
            this.emit('feed-added', feed);
            return feed;
        }
        }
    }

    async searchAccountByName(name) {
        switch (name) {
        case 'bob':
            return [new MockUser('user1', 'Bob Bobson')];
        case 'alice':
            return [new MockUser('user2', 'Alice Bobson')];
        case 'charlie':
            return [new MockUser('user3', 'Charlie Bobson')];
        default:
            return [];
        }
    }

    async getUserByAccount(account) {
        switch (account) {
        case 'user1':
            return new MockUser('user1', 'Bob Bobson');
        case 'user2':
            return new MockUser('user2', 'Alice Bobson');
        case 'user3':
            return new MockUser('user3', 'Charlie Bobson');
        default:
            throw new Error(`invalid mock account ${account}`);
        }
    }

    async getAccountForIdentity(identity) {
        if (identity.startsWith('mock-account:'))
            return identity.substring('mock-account:'.length);

        switch (identity) {
        case 'phone:+1555123456':
        case 'email:bob@example.com':
            return 'user1';
        case 'email:alice@example.com':
            return 'user2';
        case 'email:charlie@example.com':
            return 'user3';
        default:
            return null;
        }
    }
};
