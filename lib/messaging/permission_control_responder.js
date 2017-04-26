// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const Config = require('../config');
const Protocol = require('../tiers/protocol');

class ResponderFeed {
    constructor(executor, manager, messaging, feed) {
        console.log('Starting responder feed ' + feed.feedId);

        this._executor = executor;
        this._manager = manager;
        this._messaging = messaging;
        this._feed = feed;

        this._incomingMessageListener = this._onIncomingMessage.bind(this);
    }

    _onIncomingMessage(message) {
        if (message.type !== 'text' || !message.text)
            return;

        try {
            var parsed = JSON.parse(message.text);
        } catch(e) {
            return;
        }

        if (parsed.version !== 1)//|| parsed.ns !== Config.RDF_BASE)
            return;
        switch (parsed.op) {
        case 'execute':
            this._handleExecute(message, parsed);
            break;
        case 'execute-reply':
            this._handleReply(message, parsed);
            break;

        case 'install-rule':
            this._handleInstallRule(message, parsed);
            break;

        // other messages belong to other protocols/subsystems, ignore them
        }
    }

    _handleReply(message, parsed) {
        var feedId = this._feed.feedId;
        try {
            var opId = parsed.id;
            var result = parsed.result;
            var error = parsed.error;
        } catch(e) {
            console.log('Failed to unmarshal permission control response from ' + message.sender + ': ' + e.message);
            return;
        }

        this._manager.handleReply(feedId, opId, result, error);
    }

    _handleInstallRule(message, parsed) {
        var principal = 'omlet:' + message.sender;
        try {
            var rule = parsed.rule;
            var opId = parsed.id;
        } catch(e) {
            console.log('Failed to unmarshal permission control request from ' + principal + ': ' + e.message);
            return;
        }

        this._executor.installRule(principal, rule).then((result) => {
            return this._feed.sendItem({
                version:1, ns: Config.RDF_BASE, op:'execute-reply',
                id: opId,
                error: null });
        }, (error) => {
            if (!error.code && error instanceof TypeError)
                error.code = 'EINVAL';
            return this._feed.sendItem({
                version:1, ns: Config.RDF_BASE, op:'execute-reply',
                id: opId,
                error: { code: error.code, message: error.message } });
        }).catch((e) => {
            console.error('Failed to process remote execution request: ' + e.message);
        }).done();
    }

    _handleExecute(message, parsed) {
        var principal = 'omlet:' + message.sender;
        try {
            var device = Protocol.selector.unmarshal(this._messaging, parsed.device);
            var channel = parsed.channel;
            var channelType = parsed.channelType;
            var args = Protocol.params.unmarshal(this._messaging, parsed.args);
            var opId = parsed.id;
        } catch(e) {
            console.log('Failed to unmarshal permission control request from ' + principal + ': ' + e.message);
            return;
        }

        this._executor.execute(principal, device, channelType, channel, args)
            .then((result) => {
                var marshalled;
                if (channelType === 'query')
                    marshalled = result.map((r) => Protocol.params.marshal(r));
                else if (channelType === 'trigger')
                    marshalled = Protocol.params.marshal(result);
                else
                    marshalled = undefined;

                return this._feed.sendItem({
                    version:1, ns: Config.RDF_BASE, op:'execute-reply',
                    id: opId,
                    error: null,
                    result: marshalled });
            }, (error) => {
                if (!error.code && error instanceof TypeError)
                    error.code = 'EINVAL';
                return this._feed.sendItem({
                    version:1, ns: Config.RDF_BASE, op:'execute-reply',
                    id: opId,
                    error: { code: error.code, message: error.message } });
            }).catch((e) => {
                console.error('Failed to process remote execution request: ' + e.message);
            }).done();
    }

    start() {
        this._feed.on('incoming-message', this._incomingMessageListener);
        return this._feed.open();
    }

    stop() {
        this._feed.removeListener('incoming-message', this._incomingMessageListener);
        return this._feed.close();
    }
}



module.exports = class PermissionControlResponder {
    constructor(executor, messaging) {
        this._executor = executor;
        this._messaging = messaging;

        this._feeds = {};
        this._feedsByAccount = {};

        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);

        this._outstandingRequests = {};
        this._nextId = 1;
    }

    _onFeedAdded(feedId) {
        this._feeds[feedId] = new ResponderFeed(this._executor, this,
                                                this._messaging,
                                                this._messaging.getFeed(feedId));
        this._feeds[feedId].start().done();
    }

    _onFeedRemoved(feedId) {
        var feed = this._feeds[feedId];
        delete this._feeds[feedId];
        if (feed)
            feed.stop().done();

        for (var account in this._feedsByAccount) {
            if (this._feedsByAccount[account] === feedId)
                delete this._feedsByAccount[account];
        }
    }

    start() {
        return this._messaging.getFeedList().then((feeds) => {
            this._messaging.on('feed-added', this._feedAddedListener);
            this._messaging.on('feed-removed', this._feedRemovedListener);

            feeds.forEach(this._onFeedAdded, this);
        });
    }

    stop() {
        this._messaging.removeListener('feed-added', this._feedAddedListener);
        this._messaging.removeListener('feed-removed', this._feedRemovedListener);

        for (var feedId in this._feeds)
            this._feeds[feedId].stop().done();

        return Q();
    }

    handleReply(feedId, opId, result, error) {
        var fullId = feedId + ':' + opId;

        if (!this._outstandingRequests[fullId]) {
            console.log('Unexpected remote execution reply with ID ' + fullId);
            return;
        }

        var req = this._outstandingRequests[fullId];

        if (error) {
            var e = new Error(error.message);
            if (error.code)
                e.code = error.code;
            req.reject(e);
        } else {
            var unmarshalled;
            if (req.channelType === 'query')
                unmarshalled = result.map((r) => Protocol.params.unmarshal(this._messaging, r));
            else if (req.channelType === 'trigger')
                unmarshalled = Protocol.params.unmarshal(this._messaging, result);
            else
                unmarshalled = undefined;
            req.resolve(unmarshalled);
        }
    }

    _getFeed(account) {
        if (this._feedsByAccount[account])
            return Q(this._messaging.getFeed(this._feedsByAccount[account]));

        return this._messaging.getFeedWithContact(account).then((feed) => {
            this._feedsByAccount[account] = feed.feedId;
            return feed;
        });
    }

    executeRemote(account, device, channelType, channel, args) {
        var opId = this._nextId++;

        return this._getFeed(account).then((feed) => {
            var fullId = feed.feedId + ':' + opId;
            var defer = Q.defer();
            this._outstandingRequests[fullId] = defer;
            defer.channelType = channelType;

            return feed.open().then(() => {
                return feed.sendItem({
                    version:1, ns: Config.RDF_BASE, op:'execute',
                    id: opId,
                    device: Protocol.selector.marshal(device),
                    channelType: channelType,
                    channel: channel,
                    args: Protocol.params.marshal(args) });
            }).finally(() =>  feed.close()).then(() => {
                return defer.promise;
            }).timeout(1000 * 3600, "Timed out waiting for remote user reply").finally(() => {
                delete this._outstandingRequests[fullId];
            });
        });
    }

    installRuleRemote(account, rule) {
        var opId = this._nextId++;

        return this._getFeed(account).then((feed) => {
            var fullId = feed.feedId + ':' + opId;
            var defer = Q.defer();
            this._outstandingRequests[fullId] = defer;
            defer.channelType = 'rule';

            return feed.open().then(() => {
                return feed.sendItem({
                    version:1, ns: Config.RDF_BASE, op:'install-rule',
                    id: opId,
                    rule: rule });
            }).finally(() =>  feed.close()).then(() => {
                return defer.promise;
            }).timeout(1000 * 3600, "Timed out waiting for remote user reply").finally(() => {
                delete this._outstandingRequests[fullId];
            });
        });
    }
}
