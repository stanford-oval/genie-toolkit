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
    constructor(executor, manager, messaging) {
        this._executor = executor;
        this._manager = manager;
        this._messaging = messaging;

        this._incomingMessageListener = this._onIncomingMessage.bind(this);
    }

    _onIncomingMessage(feedId, message) {
        if (message.type !== 'text' || !message.text)
            return;

        try {
            var parsed = JSON.parse(message.text);
        } catch(e) {
            console.log('Failed parse incoming message as JSON: ' + e.message);
            return;
        }

        if (parsed.version !== 1){//|| parsed.ns !== Config.RDF_BASE)
            console.log('Invalid version or namespace');
            return;
        }
        switch (parsed.op) {
        case 'execute':
            this._handleExecute(feedId, message, parsed);
            break;
        case 'execute-reply':
            this._handleReply(feedId, message, parsed);
            break;
        case 'install-rule':
            this._handleInstallRule(feedId, message, parsed);
            break;
        case 'remote-data':
            this._handleRemoteData(feedId, message, parsed);
            break;

        default:
            // other messages belong to other protocols/subsystems, ignore them
            //console.log('Unhandled op ' + parsed.op);
        }
    }

    _handleRemoteData(feedId, message, parsed) {
        var principal = this._messaging.type + '-account:' + message.sender;
        try {
            var token = parsed.token;
            var data = Protocol.params.unmarshal(this._messaging, parsed.data);
        } catch(e) {
            console.log('Failed to unmarshal remote data message from ' + message.sender + ': ' + e.message);
            return;
        }

        this._manager.handleData(principal, token, data);
    }

    _handleReply(feedId, message, parsed) {
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

    _handleInstallRule(feedId, message, parsed) {
        var principal = this._messaging.type + '-account:' + message.sender;
        try {
            var identity = parsed.identity;
            var rule = parsed.rule;
            var opId = parsed.id;
        } catch(e) {
            console.log('Failed to unmarshal permission control request from ' + principal + ': ' + e.message);
            return;
        }

        this._manager.installRuleReceived(feedId, opId, principal, identity, rule);
        var feed = this._messaging.getFeed(feedId);
        Q.try(() => {
            feed.open();
        }).then(() => {
            return this._executor.installRule(principal, identity, rule);
        }).then((result) => {
            this._manager.installRuleApproved(feedId, opId);
            return feed.sendItem({
                version:1, ns: Config.RDF_BASE, op:'execute-reply',
                id: opId,
                error: null });
        }, (error) => {
            this._manager.installRuleDenied(feedId, opId);
            if (!error.code && error instanceof TypeError)
                error.code = 'EINVAL';
            return feed.sendItem({
                version:1, ns: Config.RDF_BASE, op:'execute-reply',
                id: opId,
                error: { code: error.code, message: error.message } });
        }).finally(() => feed.close()).catch((e) => {
            console.error('Failed to process remote execution request: ' + e.message);
        }).done();
    }

    _handleExecute(feedId, message, parsed) {
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

        var feed = this._messaging.getFeed(feedId);
        feed.open().then(() => {
            return this._executor.execute(principal, device, channelType, channel, args);
        }).then((result) => {
            var marshalled;
            if (channelType === 'query')
                marshalled = result.map((r) => Protocol.params.marshal(r));
            else if (channelType === 'trigger')
                marshalled = Protocol.params.marshal(result);
            else if (channelType === 'format-trigger' || channelType === 'format-query')
                marshalled = result;
            else
                marshalled = undefined;

            return feed.sendItem({
                version:1, ns: Config.RDF_BASE, op:'execute-reply',
                id: opId,
                error: null,
                result: marshalled });
        }, (error) => {
            if (!error.code && error instanceof TypeError)
                error.code = 'EINVAL';
            console.log(error.stack);
            return feed.sendItem({
                version:1, ns: Config.RDF_BASE, op:'execute-reply',
                id: opId,
                error: { code: error.code, message: error.message } });
        }).finally(() => feed.close()).catch((e) => {
            console.error('Failed to process remote execution request: ' + e.message);
        }).done();
    }

    start() {
        this._messaging.on('incoming-message', this._incomingMessageListener);
    }

    stop() {
        this._messaging.removeListener('incoming-message', this._incomingMessageListener);
    }
}



module.exports = class PermissionControlResponder {
    constructor(executor, messaging) {
        this._executor = executor;
        this._messaging = messaging;

        this._feedsByAccount = {};

        this._responder = null;
        this._feedRemovedListener = this._onFeedRemoved.bind(this);

        this._outstandingRequests = {};
        this._nextId = process.pid * 65536 + 1;

        this._subscriptions = {};
        this._deferredDataPackets = {};
        this._receivedInstallRules = {};
    }

    _extractTokensInvocation(invocation, tokens) {
        if (!invocation)
            return;
        invocation.args.forEach((a) => {
            if (a.type === 'Entity(tt:flow_token)')
                tokens.add(a.value.value);
        });
    }

    _extractTokens(rule, tokens) {
        if (rule.setup)
            return this._extractTokens(rule.setup, tokens);
        if (rule.rule) {
            this._extractTokensInvocation(rule.rule.trigger, tokens);
            this._extractTokensInvocation(rule.rule.query, tokens);
            this._extractTokensInvocation(rule.rule.action, tokens);
        } else {
            this._extractTokensInvocation(rule.trigger, tokens);
            this._extractTokensInvocation(rule.query, tokens);
            this._extractTokensInvocation(rule.action, tokens);
        }
    }

    installRuleReceived(feedId, opId, principal, identity, rule) {
        console.log('Received install-rule command from ' + principal);
        if (identity)
            console.log('Principal claims to own ' + identity);
        else
            console.log('Principal does not claim an identity');

        var tokens = new Set;
        this._extractTokens(rule, tokens);
        for (var token of tokens) {
            var subid = principal + ':' + token;
            console.log('Waiting for approval of token ' + subid);
            this._receivedInstallRules[subid] = feedId + ':' + opId;
        }
    }

    installRuleApproved(feedId, opId) {
        var fullId = feedId + ':' + opId;
        for (var subid in this._receivedInstallRules) {
            if (this._receivedInstallRules[subid] === fullId) {
                console.log('Approved token ' + subid);
                setTimeout(() => {
                    delete this._receivedInstallRules[subid];
                    delete this._deferredDataPackets[subid];
                }, 30 * 3600 * 1000);
            }
        }
    }

    installRuleDenied(feedId, opId) {
        var fullId = feedId + ':' + opId;
        for (var subid in this._receivedInstallRules) {
            if (this._receivedInstallRules[subid] === fullId) {
                console.log('Rejected token ' + subid);
                delete this._receivedInstallRules[subid];
                delete this._deferredDataPackets[subid];
            }
        }
    }

    subscribe(principal, token, callback) {
        var subid = principal + ':' + token;
        if (this._subscriptions[subid])
            this._subscriptions[subid].push(callback);
        else
            this._subscriptions[subid] = [callback];
        delete this._receivedInstallRules[subid];
        if (this._deferredDataPackets[subid]) {
            var deferred = this._deferredDataPackets[subid];
            console.log('Flushing ' + deferred.length + ' data messages for ' + subid);
            deferred.forEach((data) => {
                setImmediate(() => callback(data));
            });
            delete this._deferredDataPackets[subid];
        }
    }

    unsubscribe(principal, token, callback) {
        var subid = principal + ':' + token;
        var index = this._subscriptions[subid].indexOf(callback);
        if (index < 0)
            return;
        this._subscriptions[subid].splice(index, 1);
        if (this._subscriptions[subid].length === 0)
            delete this._subscriptions[subid];
    }

    handleData(principal, token, data) {
        console.log('Received data message from ' + principal + ':' + token);
        console.log('Data size: ' + JSON.stringify(data).length);
        var subid = principal + ':' + token;
        var callbacks = this._subscriptions[subid] || [];
        if (callbacks.length === 0) {
            if (!(subid in this._receivedInstallRules))
                return;
            if (this._deferredDataPackets[subid]) {
                this._deferredDataPackets[subid].push(data);
            } else {
                this._deferredDataPackets[subid] = [data];
            }
        } else {
            callbacks.forEach((c) => c(data));
        }
    }

    sendData(principal, token, data) {
        return this._getFeed(principal).then((feed) => {
            return feed.open().then(() => {
                return feed.sendItem({
                    version:1, ns: Config.RDF_BASE, op:'remote-data',
                    token: token,
                    data: Protocol.params.marshal(data) });
            }).finally(() =>  feed.close());
        });
    }

    _onFeedRemoved(feedId) {
        for (var account in this._feedsByAccount) {
            if (this._feedsByAccount[account] === feedId)
                delete this._feedsByAccount[account];
        }
    }

    start() {
        this._responder = new ResponderFeed(this._executor, this,
                                            this._messaging);
        this._responder.start();
        this._messaging.on('feed-removed', this._feedRemovedListener);

        return Q();
    }

    stop() {
        this._messaging.removeListener('feed-removed', this._feedRemovedListener);
        this._responder.stop();

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
            else if (req.channelType === 'format-trigger' || req.channelType === 'format-query')
                unmarshalled = result;
            else
                unmarshalled = undefined;
            req.resolve(unmarshalled);
        }
    }

    _getFeed(principal) {
        console.log('_getFeed ' + principal);
        if (this._feedsByAccount[principal])
            return Q(this._messaging.getFeed(this._feedsByAccount[principal]));

        if (principal.startsWith('omlet-account:'))
            principal = principal.substr('omlet-account:'.length);

        return this._messaging.getFeedWithContact(principal).then((feed) => {
            this._feedsByAccount[principal] = feed.feedId;
            return feed;
        });
    }

    executeRemote(principal, device, channelType, channel, args) {
        var opId = this._nextId++;

        return this._getFeed(principal).then((feed) => {
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

    installRuleRemote(principal, identity, rule) {
        var opId = this._nextId++;

        return this._getFeed(principal).then((feed) => {
            var fullId = feed.feedId + ':' + opId;
            var defer = Q.defer();
            this._outstandingRequests[fullId] = defer;
            defer.channelType = 'rule';

            return feed.open().then(() => {
                return feed.sendItem({
                    version:1, ns: Config.RDF_BASE, op:'install-rule',
                    id: opId,
                    identity: identity,
                    rule: rule });
            }).finally(() =>  feed.close()).then(() => {
                return defer.promise;
            }).timeout(1000 * 3600, "Timed out waiting for remote user reply").finally(() => {
                delete this._outstandingRequests[fullId];
            });
        });
    }
}
