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

module.exports = new lang.Class({
    Name: 'RemoteKeyword',
    Extends: RefCounted,

    _init: function(messaging, localstore, scope, name, feedId, key) {
        this.parent();

        this._messaging = messaging;
        this._localStore = localstore;

        this._scope = scope;
        this._feedId = feedId;

        this.local = this._localStore.getKeyword(name, key + '-self');
        this._ownAccount = null;
        this._ownId = null;
        this._memberToKeywordMap = {};
        this._value = [];

        this.name = name;
        this.uniqueId = key;
    },

    get value() {
        return this._value;
    },

    _getKeywordForMember: function(id) {
        var kw = this._localStore.getKeyword(this.name, this.uniqueId + '-' + id);

        return kw.open().then(function() {
            this._memberToKeywordMap[id] = kw;
            return kw;
        }.bind(this));
    },

    _syncAndEmit: function(senderId) {
        var members = this._feed.getMembers();
        var value = new Array(members.length);

        var keywordlist = members.map(function(m, i) {
            if (i == 0)
                return this.local;
            else if (this._memberToKeywordMap[m.id])
                return this._memberToKeywordMap[m.id];
            else
                return this._getKeywordForMember(m.id);
        }, this);

        return Q.all(keywordlist).then(function(kws) {
            var changedMember = null;
            if (senderId === null)
                changedMember = 0;
            for (var i = 0; i < members.length; i++) {
                var id = members[i].id;
                value[i] = kws[i].value;
                if (id === senderId)
                    changedMember = i;
            }

            console.log('value', value);
            this._value = value;
            this.emit('changed', changedMember);
        }.bind(this));
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
            this._refreshTimeout = null;
        }.bind(this), 1000);
    },

    _handleChangeValue: function(parsed) {
        if (msg.target !== this._ownAccount)
            return;
        this._local.changeValue(msg.value);
    },

    _handleNewValue: function(msg, parsed) {
        Q.try(function() {
            if (msg.senderId in this._memberToKeywordMap)
                return this._memberToKeywordMap[msg.senderId];
            else
                return this._getKeywordForMember(msg.senderId);
        }.bind(this)).then(function(keyword) {
            if (keyword.changeValue(parsed.value))
                return this._syncAndEmit(msg.senderId);
        }).done();
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
        this._syncAndEmit(null).done();
    },

    _doOpen: function() {
        this._feed = this._messaging.getFeed(this._feedId);

        this._newMessageListener = this._onNewMessage.bind(this);
        this._feed.on('incoming-message', this._newMessageListener);

        this._localChangeListener = this._onLocalChange.bind(this);
        this.local.on('changed', this._localChangeListener);

        return this.local.open().then(function() {
            return this._feed.open();
        }.bind(this)).then(function() {
            this._ownId = this._feed.ownId;
            return this._messaging.getAccountById(this._ownId);
        }.bind(this)).then(function(account) {
            this._ownAccount = account;

            this._sendRefresh();
            this._sendValue();
            return this._syncAndEmit();
        }.bind(this));
    },

    _doClose: function() {
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = null;
        }

        this.local.removeListener('changed', this._localChangeListener);
        this._feed.removeListener('incoming-message', this._newMessageListener);

        var keywordlist = this._feed.getMembers().map(function(m, i) {
            if (i == 0)
                return this.local;
            else if (this._memberToKeywordMap[m.id])
                return this._memberToKeywordMap[m.id];
            else
                return this._getKeywordForMember(m.id);
        }, this);

        return Q.all(keywordlist).then(function(kws) {
            return Q.all(kws.map(function(k) { return k.close(); }));
        }).then(function() {
            return this._feed.close();
        }.bind(this)).then(function() {
            return this.local.close();
        }.bind(this));
    },
});
