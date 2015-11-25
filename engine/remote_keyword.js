// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const lang = require('lang');
const adt = require('adt');

const RefCounted = require('./util/ref_counted');

const RemoteKeyword = new lang.Class({
    Name: 'RemoteKeyword',
    Extends: RefCounted,

    _init: function(messaging, localstore, scope, name, feedId, key) {
        this.parent();

        this._messaging = messaging;
        this._localStore = localstore;

        this._scope = scope;
        this._name = name;
        this._feedId = feedId;

        this.local = null;
        this._ownAccount = null;
        this._ownId = null;
        this._memberToKeywordMap = {};
        this._value = [];

        this.uniqueId = key;
    },

    get value() {
        return this._value;
    },

    _syncAndEmit: function(senderId) {
        var members = this._feed.getMembers();
        var value = new Array(members.length);

        var changedMember;
        value[0] = this.local.value;
        if (senderId === null)
            changedMember = 0;
        for (var i = 1; i < members.length; i++) {
            var id = members[i].id;
            if (!this._memberToKeywordMap[id])
                this._memberToKeywordMap[id] = this._localStore.getKeyword(this.uniqueId + '-' + id);
            value[i] = this._memberToKeywordMap[id].value;
            if (id === senderId)
                changedMember = i;
        }

        this._value = value;
        this.emit('changed', changedMember);
    },

    _sendChange: function(target, value) {
        this._feed.sendItem({ version: 2,
                              op: 'change-value',
                              scope: this._scope,
                              keyword: this._name,
                              target: target,
                              value: value });
    },

    _sendRefresh: function() {
        this._feed.sendItem({ version: 2,
                              op: 'refresh',
                              scope: this._scope,
                              keyword: this._name });
    },

    _sendValue: function() {
        this._feed.sendItem({ version: 2,
                              op: 'new-value',
                              scope: this._scope,
                              keyword: this._name,
                              value: this.local.value });
    },

    changeValue: function(v, owner) {
        var members = this._feed.getMembers();
        var id = members[owner].id;
        if (id === this._ownId)
            this._local.changeValue(v);
        else
            this._sendChange(members[owner].account, v[i]);
    },

    _handleRefresh: function() {
        if (this._refreshTimeout)
            return;

        this._refreshTimeout = setTimeout(function() {
            this._sendValue();
        }.bind(this), 1000);
    },

    _handleChangeValue: function(parsed) {
        if (msg.target !== this._ownAccount)
            return;
        this._local.changeValue(msg.value);
    },

    _handleNewValue: function(msg, parsed) {
        if (!(msg.senderId in this._memberToKeywordMap))
            this._memberToKeywordMap[msg.senderId] = this._localStore.getKeyword(this.uniqueId + '-' + msg.senderId);

        var keyword = this._memberToKeywordMap[msg.senderId];
        if (keyword.changeValue(parsed.value))
            this._syncAndEmit(msg.senderId);
    },

    _onNewMessage: function(msg) {
        try {
            if (!msg.text)
                return;
            var parsed = JSON.parse(msg.text);
            if (parsed.version !== 2)
                return;
            if (parsed.scope !== this._scope || parsed.name !== this._name)
                return;

            console.log('Received Omlet message on RemoteKeyword: ', parsed);

            switch(parsed.op) {
            case 'refresh':
                this._handleRefresh();
                break;
            case 'change-value':
                this._handleChangeValue(parsed);
                break;
            case 'new-value':
                this._handleNewValue(msg, parsed);
                break;
            }
        } catch(e) {
            if (e.name === 'SyntaxError')
                return;
            else
                throw e;
        }
    },

    _onLocalChange: function() {
        this._syncAndEmit(null);
    },

    _doOpen: function() {
        this.local = this._localStore.get(this.uniqueId + '-self');
        this._feed = this._messaging.getFeed(this._feedId);

        this._newMessageListener = this._onNewMessage.bind(this);
        this._feed.on('incoming-message', this._newMessageListener);

        this._localChangeListener = this._onLocalChange.bind(this);
        this.local.on('changed', this._localChangeListener);

        return this._feed.open().then(function() {
            this._ownId = this._feed.ownIds[0];
            return this._messaging.getAccountById(this._ownId);
        }.bind(this)).then(function(account) {
            this._ownAccount = account;
        });
    },

    _doClose: function() {
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = null;
        }

        this.local.removeListener('changed', this._localChangeListener);
        this._feed.removeListener('incoming-message', this._newMessageListener);

        return this._feed.close();
    },
});
