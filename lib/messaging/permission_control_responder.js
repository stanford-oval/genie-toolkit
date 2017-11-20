// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const ThingTalk = require('thingtalk');

const Config = require('../config');
const Protocol = require('../tiers/protocol');

const CURRENT_VERSION = 2;

const Message = {
    INSTALL_PROGRAM: 'i',
    ABORT_PROGRAM: 'a',
    DATA: 'd',
}

class ResponderFeed {
    constructor(manager, messaging) {
        this._manager = manager;
        this._messaging = messaging;

        this._incomingMessageListener = this._onIncomingMessage.bind(this);
    }

    _onIncomingMessage(feedId, message) {
        let parsed;
        try {
            switch (message.type) {
            case 'text':
                parsed = JSON.parse(message.text);
                break;
            case 'app':
                parsed = message.json;
                break;
            default:
                return;
            }
        } catch(e) {
            console.log('Failed parse incoming message as JSON: ' + e.message);
            return;
        }
        if (!parsed)
            return;

        if (parsed.v !== CURRENT_VERSION) {
            console.log('Invalid version');
            return;
        }
        switch (parsed.op) {
        case Message.ABORT_PROGRAM:
            this._handleAbortProgram(feedId, message, parsed);
            break;
        case Message.INSTALL_PROGRAM:
            this._handleInstallProgram(feedId, message, parsed);
            break;
        case Message.DATA:
            this._handleRemoteData(feedId, message, parsed);
            break;

        default:
            // other messages belong to other protocols/subsystems, ignore them
            //console.log('Unhandled op ' + parsed.op);
        }
    }

    _handleAbortProgram(feedId, message, parsed) {
        let principal = this._messaging.type + '-account:' + message.sender;
        let uniqueId = parsed.uuid;
        let error = null;
        if (parsed.err) {
            error = new Error(parsed.err.m);
            error.code = parsed.err.c;
        }

        this._manager.handleAbortProgram(principal, uniqueId, error);
    }

    _handleRemoteData(feedId, message, parsed) {
        let principal = this._messaging.type + '-account:' + message.sender;
        let token, data;
        try {
            token = parsed.t;
            data = Protocol.params.unmarshal(parsed.d);
        } catch(e) {
            console.log('Failed to unmarshal remote data message from ' + message.sender + ': ' + e.message);
            return;
        }

        this._manager.handleData(principal, token, data);
    }

    _handleInstallProgram(feedId, message, parsed) {
        let principal = this._messaging.type + '-account:' + message.sender;
        let identity, code, program;
        let uniqueId;
        try {
            uniqueId = parsed.uuid;
            identity = parsed.id;
            code = parsed.c;
        } catch(e) {
            console.log('Failed to unmarshal permission control request from ' + principal + ': ' + e.message);
            return;
        }

        this._manager.handleInstallProgram(principal, identity, feedId, uniqueId, code);
    }

    start() {
        this._messaging.on('incoming-message', this._incomingMessageListener);
    }

    stop() {
        this._messaging.removeListener('incoming-message', this._incomingMessageListener);
    }
}



module.exports = class PermissionControlResponder {
    constructor(executor, messaging, tierManager, devices, schemaRetriever) {
        this._executor = executor;
        this._messaging = messaging;
        this._tierManager = tierManager;
        this._devices = devices;
        this._schemaRetriever = schemaRetriever;

        this._responder = null;
        this._feedRemovedListener = this._onFeedRemoved.bind(this);

        this._subscriptions = new Map;
        this._deferredDataPackets = new Map;
        this._receivedInstallPrograms = new Map;
    }

    _installProgramReceived(feedId, uniqueId, principal, identity, program) {
        if (this._tierManager.ownTier === 'cloud' && this._devices.hasDevice('thingengine-own-phone')) {
            console.log('Ignoring install rule because phone is also present');
            return false;
        }

        console.log('Received install-rule command from ' + principal);

        let tokens = ThingTalk.Generate.getFlowTokens(program);
        for (let token of tokens) {
            let subid = principal + ':' + token;
            console.log('Waiting for approval of token ' + subid);
            this._receivedInstallPrograms.set(subid, feedId + ':' + uniqueId);
        }
        return true;
    }

    _installProgramApproved(feedId, uniqueId) {
        let fullId = feedId + ':' + uniqueId;
        for (let subid of this._receivedInstallPrograms.keys()) {
            if (this._receivedInstallPrograms.get(subid) === fullId) {
                console.log('Approved token ' + subid);
                setTimeout(() => {
                    this._receivedInstallPrograms.delete(subid);
                    this._deferredDataPackets.delete(subid);
                }, 30 * 3600 * 1000);
            }
        }
    }

    _installProgramDenied(feedId, uniqueId) {
        let fullId = feedId + ':' + uniqueId;
        for (let subid of this._receivedInstallPrograms.keys()) {
            if (this._receivedInstallPrograms.get(subid) === fullId) {
                console.log('Rejected token ' + subid);
                this._receivedInstallPrograms.delete(subid);
                this._deferredDataPackets.delete(subid);
            }
        }
    }

    subscribe(principal, token, callback) {
        let subid = principal + ':' + token;
        if (this._subscriptions.has(subid))
            this._subscriptions.get(subid).push(callback);
        else
            this._subscriptions.set(subid, [callback]);
        this._receivedInstallPrograms.delete(subid);
        if (this._deferredDataPackets.has(subid)) {
            var deferred = this._deferredDataPackets.get(subid);
            console.log('Flushing ' + deferred.length + ' data messages for ' + subid);
            deferred.forEach((data) => {
                setImmediate(() => callback(data));
            });
            this._deferredDataPackets.get(subid);
        }
    }

    unsubscribe(principal, token, callback) {
        let subid = principal + ':' + token;
        let list = this._subscriptions.get(subid);
        let index = list.indexOf(callback);
        if (index < 0)
            return;
        list.splice(index, 1);
        if (list.length === 0)
            this._subscriptions.delete(subid);
    }

    handleAbortProgram(principal, uniqueId, error) {
        // FINISHME
    }

    _typecheckProgram(code) {
        // we will show a confirmation string to the user and store it in the app database,
        // so always fetch metadata in addition to type information
        return Q(ThingTalk.Grammar.parseAndTypecheck(code, this._schemaRetriever, true));
    }

    handleInstallProgram(principal, identity, feedId, uniqueId, code) {
        this._typecheckProgram(code).then((program) => {
            if (this._installProgramReceived(feedId, uniqueId, principal, identity, program))
                return this._executor.installProgram(principal, identity, program, uniqueId).then(() => true);
            else
                return false;
        }).then((result) => {
            if (result)
                this._installProgramApproved(feedId, uniqueId);
        }, (error) => {
            this._installProgramDenied(feedId, uniqueId);
            if (!error.code)
                console.error(error.stack);
            if (!error.code && error instanceof TypeError)
                error.code = 'EINVAL';
            return this.abortProgramRemote(principal, uniqueId, error);
        }).catch((e) => {
            console.error('Failed to process remote execution request: ' + e.message);
        }).done();
    }

    handleData(principal, token, data) {
        let subid = principal + ':' + token;
        console.log('Received data message from ' + subid);
        console.log('Data size: ' + JSON.stringify(data).length);
        let callbacks = this._subscriptions.get(subid) || [];
        if (callbacks.length === 0) {
            if (!this._receivedInstallPrograms.has(subid))
                return;
            if (this._deferredDataPackets.has(subid)) {
                this._deferredDataPackets.get(subid).push(data);
            } else {
                this._deferredDataPackets.set(subid, [data]);
            }
        } else {
            callbacks.forEach((c) => c(data));
        }
    }

    _onFeedRemoved(feedId) {
        for (var account in this._feedsByAccount) {
            if (this._feedsByAccount[account] === feedId)
                delete this._feedsByAccount[account];
        }
    }

    start() {
        this._responder = new ResponderFeed(this, this._messaging);
        this._responder.start();
        this._messaging.on('feed-removed', this._feedRemovedListener);

        return Q();
    }

    stop() {
        if (!this._responder)
            return;

        this._messaging.removeListener('feed-removed', this._feedRemovedListener);
        this._responder.stop();

        return Q();
    }

    _getFeed(principal) {
        if (typeof principal === 'string' && principal.startsWith(this._messaging.type + '-room:'))
            return this._messaging.getFeedByAlias(principal.substring(this._messaging.type.length + '-room:'.length));
        return this._messaging.getFeedWithContact(principal).then((feed) => {
            return feed;
        });
    }

    _sendMessage(principal, msg) {
        if (Array.isArray(principal))
            principal = principal.map((p) => String(p));
        else
            principal = String(principal);
        return this._getFeed(principal).then((feed) => {
            if (!feed)
                throw new Error('Invalid room, or failed to create room with contact');
            return feed.open().then(() => {
                msg.v = CURRENT_VERSION;
                return feed.sendItem(msg);
            });
        });
    }

    sendData(principal, token, data) {
        return this._sendMessage(principal, {
            op: Message.DATA,
            t: String(token),
            d: Protocol.params.marshal(data)
        });
    }

    abortProgramRemote(principal, uniqueId, err) {
        return this._sendMessage(principal, {
            op: Message.ABORT_PROGRAM,
            uuid: uniqueId,
            err: err ? { m: err.message, c: err.code } : null
        });
    }

    installProgramRemote(principal, identity, uniqueId, program) {
        return this._sendMessage(principal, {
            op: Message.INSTALL_PROGRAM,
            uuid: uniqueId,
            id: identity,
            c: ThingTalk.Ast.prettyprint(program, true).trim()
        });
    }
}
