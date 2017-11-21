// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const ThingTalk = require('thingtalk');

const Config = require('../config');
const Protocol = require('../tiers/protocol');
const ArraySet = require('../util/array_set');
const ChannelStateBinder = require('../db/channel');

const CURRENT_VERSION = 3;

const Message = {
    INSTALL: 'i',
    ABORT: 'a',
    DATA: 'd',
    END: 'e',
    JOIN: 'j'
};

class Subscription extends events.EventEmitter {
    constructor(messaging, principal, flowId, state, sharedState) {
        super();

        this._messaging = messaging;
        this._principal = principal;
        this._flowId = flowId;
        this.sharedState = sharedState;
        this.state = state;

        if (!state['members'])
            state['members'] = [];
        this._members = new ArraySet(state['members']);
        if (!state['member-ended'])
            state['member-ended'] = [];
        this._memberEnded = new ArraySet(state['member-ended']);

        if (state['all-ended'])
            setImmediate(() => this.emit('end'));
    }

    _checkJoinAllowed(user) {
        if (Array.isArray(this._principal))
            return Q(this._principal.indexOf(user) >= 0);

        return this._messaging.getFeedByAlias(this._principal).then((feed) => {
            return feed.getMembers().indexOf(user) >= 0;
        });
    }

    processJoin(user) {
        return this._checkJoinAllowed(user).then((isAllowed) => {
            if (!isAllowed)
                return;

            if (this._members.add(user))
                return this.sharedState.flushToDisk();
        });
    }

    processData(user, data) {
        if (this.state['all-ended'])
            return;
        this.emit('data', data);
    }

    processEnd(user) {
        if (this.state['all-ended'])
            return;
        this._memberEnded.add(user);
        this._checkEnded();
    }

    processAbort(user) {
        if (this.state['all-ended'])
            return;
        if (this._members.delete(user)) {
            this._memberEnded.delete(user);
            this._checkEnded();
        }
    }

    _checkEnded() {
        if (this._members.size !== this._memberEnded.size) {
            this.sharedState.changed();
            return;
        }
        this.state['all-ended'] = true;
        this.sharedState.flushToDisk().then(() => {
        }, (e) => {
            console.error('Failed to write subscription state to disk', e);
            // emit end without saving, and hope for the best
            this.emit('end');
        }).done();
    }
}

class SharedProgramState {
    constructor(platform, messaging, uniqueId) {
        this._platform = platform;
        this._messaging = messaging;

        this.state = null;
        this._uniqueId = uniqueId;
        this._deferredDataPackets = {};

        this._subscriptions = {};
    }

    writeToDisk() {
        return this._ensureState().then((state) => state.flushToDisk());
    }

    subscribe(principal, flowId) {
        return this._ensureState((state) => {
            if (this._subscriptions[flowId])
                return this._subscriptions[flowId];

            let substate = state.get('subscriptions')[flowId];
            if (!substate)
                substate = state.get('subscriptions')[flowId] = {};
            let sub = new Subscription(this._messaging, principal, flowId, substate, state);
            this._subscriptions[flowId] = sub;

            let deferred = this._deferredDataPackets[flowId] || [];
            setImmediate(() => {
                for (let [call, ...args] of deferred)
                    sub[call](...args);
            });
            delete this._deferredDataPackets[flowId];
        });
    }

    processJoin(user) {
        return this._ensureState().then((state) => {
            if (state.get('all-ended'))
                return;

            for (let flowId in this._subscriptions)
                this._subscriptions.processJoin(user);
        });
    }

    processAbort(user) {
        return this._ensureState().then((state) => {
            if (state.get('all-ended'))
                return;

            for (let flowId in this._subscriptions)
                this._subscriptions.processAbort(user);
        });
    }

    processData(user, flowId, data) {
        return this._ensureState().then((state) => {
            if (state.get('all-ended'))
                return;

            let sub = this._subscriptions[flowId];
            if (!sub) {
                if (!this._deferredDataPackets[flowId])
                    this._deferredDataPackets[flowId] = [];
                this._deferredDataPackets[flowId].push(['processData', user, data])
                return;
            }
            sub.processData(user, data);
        });
    }

    processEnd(user, flowId) {
        return this._ensureState().then((state) => {
            if (state.get('all-ended'))
                return;

            let sub = this._subscriptions[flowId];
            if (!sub) {
                if (!this._deferredDataPackets[flowId])
                    this._deferredDataPackets[flowId] = [];
                this._deferredDataPackets[flowId].push(['processEnd', user])
                return;
            }
            sub.processEnd(user);
        });
    }

    _ensureState() {
        if (this.state)
            return Q(this.state);

        return this.state = new Promise((resolve, reject) => {
            let state = new ChannelStateBinder();
            state.init('org.thingpedia.builtin.thingengine.remote-subscriptions-' + this._uniqueId)
            state.open().then(() => {
                if (!state.get('subscriptions'))
                    state.set('subscriptions', {});
                resolve(state);
            }, reject);
        });
    }
}

module.exports = class PermissionControlResponder {
    constructor(platform, executor, messaging, tierManager, devices, schemaRetriever) {
        this._platform = platform;
        this._executor = executor;
        this._messaging = messaging;
        this._tierManager = tierManager;
        this._devices = devices;
        this._schemaRetriever = schemaRetriever;

        this._incomingMessageListener = this._onIncomingMessage.bind(this);
        this._subscriptions = new Map;
    }

    _getSharedProgramState(uniqueId, create) {
        if (this._subscriptions.has(uniqueId)) {
            return this._subscriptions.get(uniqueId);
        } else if (create) {
            let state = new SharedProgramState(this._platform, this._messaging, uniqueId);
            this._subscriptions.set(uniqueId, state);
            return state;
        } else {
            return null;
        }
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
        case Message.ABORT:
            this._handleAbortProgram(feedId, message, parsed);
            break;
        case Message.INSTALL:
            this._handleInstallProgram(feedId, message, parsed);
            break;
        case Message.DATA:
            this._handleRemoteData(feedId, message, parsed);
            break;
        case Message.END:
            this._handleRemoteEnd(feedId, message, parsed);
            break;
        case Message.JOIN:
            this._handleRemoteJoin(feedId, message, parsed);
            break;

        default:
            // other messages belong to other protocols/subsystems, ignore them
            //console.log('Unhandled op ' + parsed.op);
        }
    }

    _handleAbortProgram(feedId, message, parsed) {
        let uniqueId = parsed.uuid;
        let error = null;
        if (parsed.err) {
            error = new Error(parsed.err.m);
            error.code = parsed.err.c;
        }

        let state = this._getSharedProgramState(uniqueId, false);
        if (state)
            return state.processAbort(message.sender);

        // FINISHME
    }

    _handleRemoteData(feedId, message, parsed) {
        let uniqueId = parsed.uuid;
        let flow = parsed.f;
        let data;
        try {
            data = Protocol.params.unmarshal(parsed.d);
        } catch(e) {
            console.log('Failed to unmarshal remote data message from ' + message.sender + ': ' + e.message);
            return;
        }

        console.log('Received data message from ' + message.sender);
        console.log('Data size: ' + JSON.stringify(data).length);
        let state = this._getSharedProgramState(uniqueId, false);
        if (state)
            return state.processData(message.sender, flow, data);
    }

    _handleRemoteEnd(feedId, message, parsed) {
        let principal = message.sender;
        let uniqueId = parsed.uuid;
        let flow = parsed.f;

        console.log('Received end message from ' + message.sender);
        let state = this._getSharedProgramState(uniqueId, false);
        if (state)
            return state.processEnd(message.sender, flow);
    }

    _handleRemoteJoin(feedId, message, parsed) {
        let uniqueId = parsed.uuid;

        let state = this._getSharedProgramState(uniqueId, false);
        if (state)
            return state.processJoin(message.sender);
    }

    subscribe(principal, uniqueId, flow) {
        let state = this._getSharedProgramState(String(uniqueId), true);
        return state.subscribe(principal, flow);
    }

    _typecheckProgram(code) {
        // we will show a confirmation string to the user and store it in the app database,
        // so always fetch metadata in addition to type information
        return Q(ThingTalk.Grammar.parseAndTypecheck(code, this._schemaRetriever, true));
    }

    handleInstallProgram(feedId, message, parsed) {
        if (this._tierManager.ownTier === 'cloud' && this._devices.hasDevice('thingengine-own-phone')) {
            console.log('Ignoring install rule because phone is also present');
            return false;
        }

        let uniqueId = parsed.uuid;
        let identity = parsed.id;
        let code = parsed.c;

        let feedPrincipal = this._messaging.type + '-room:' + feedId;
        this._getSharedProgramState(uniqueId, true);
        // join the program first
        return this._sendJoinProgram(feedPrincipal, uniqueId).then(() => {
            return this._typecheckProgram(code);
        }).then((program) => {
            return this._executor.installProgram(this._messaging.type + '-account:' + message.sender, identity, program, uniqueId).then(() => true);
        }).catch((error) => {
            this._subscriptions.delete(uniqueId);

            if (!error.code)
                console.error(error.stack);
            if (!error.code && error instanceof TypeError)
                error.code = 'EINVAL';
            return this.abortProgramRemote(feedPrincipal, uniqueId, error);
        }).catch((e) => {
            console.error('Failed to process remote execution request: ' + e.message);
        }).done();
    }

    start() {
        this._messaging.on('incoming-message', this._incomingMessageListener);
        return Q();
    }

    stop() {
        this._messaging.removeListener('incoming-message', this._incomingMessageListener);
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

    _sendJoinProgram(principal, uniqueId) {
        return this._sendMessage(principal, {
            op: Message.JOIN,
            uuid: uniqueId
        });
    }

    sendData(principal, uniqueId, flowId, data) {
        return this._sendMessage(principal, {
            op: Message.DATA,
            uuid: String(uniqueId),
            f: flowId,
            d: Protocol.params.marshal(data)
        });
    }

    sendEndOfFlow(principal, uniqueId, flowId) {
        return this._sendMessage(principal, {
            op: Message.END,
            uuid: String(uniqueId),
            f: flowId
        });
    }

    abortProgramRemote(principal, uniqueId, err) {
        return this._sendMessage(principal, {
            op: Message.ABORT,
            uuid: String(uniqueId),
            err: err ? { m: err.message, c: err.code } : null
        });
    }

    installProgramRemote(principal, identity, uniqueId, program) {
        return this._sendMessage(principal, {
            op: Message.INSTALL,
            uuid: String(uniqueId),
            id: identity,
            c: ThingTalk.Ast.prettyprint(program, true).trim()
        });
    }
}
