// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const deepEqual = require('deep-equal');

const RefCounted = require('./util/ref_counted');

module.exports = class RemoteKeyword extends RefCounted {
    constructor(messaging, localstore, scope, name, feedId, key) {
        super();

        console.log('Created remote keyword ' + name + ' in feed ' + feedId);

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
    }

    get value() {
        return this._value;
    }

    _getKeywordForMember(id) {
        var kw = this._localStore.getKeyword(this.name, this.uniqueId + '-' + id);

        return kw.open().then(function() {
            this._memberToKeywordMap[id] = kw;
            return kw;
        }.bind(this));
    }

    _syncAndEmit(senderId) {
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

            if (deepEqual(value, this._value, { strict: true }))
                return;
            console.log('value', value);
            this._value = value;
            setImmediate(function() {
                this.emit('changed', changedMember);
            }.bind(this));
        }.bind(this));
    }

    _sendRefresh() {
        this._feed.sendItem({ version: 2,
                              op: 'refresh',
                              scope: this._scope,
                              keyword: this.name });
    }

    _sendValue() {
        this._feed.sendItem({ version: 2,
                              op: 'new-value',
                              scope: this._scope,
                              keyword: this.name,
                              value: this.local.value });
    }

    changeValue(v) {
        throw new TypeError('Remote keywords cannot change value');
    }

    _handleRefresh() {
        if (this._refreshTimeout)
            return;

        this._refreshTimeout = setTimeout(function() {
            this._sendValue();
            this._refreshTimeout = null;
        }.bind(this), 1000);
    }

    _handleNewValue(msg, parsed) {
        Q.try(function() {
            if (msg.senderId in this._memberToKeywordMap)
                return this._memberToKeywordMap[msg.senderId];
            else
                return this._getKeywordForMember(msg.senderId);
        }.bind(this)).then(function(keyword) {
            if (keyword.changeValue(parsed.value))
                return this._syncAndEmit(msg.senderId);
            else
                console.log('Change value for ' + msg.senderId  + ' returned false');
        }.bind(this)).done();
    }

    _onNewMessage(msg) {
        try {
            if (!msg.text)
                return;
            var parsed = JSON.parse(msg.text);
            if (parsed.version !== 2)
                return;
            if (parsed.scope !== this._scope || parsed.keyword !== this.name)
                return;

            console.log('Received Omlet message on RemoteKeyword: ', parsed);

            switch(parsed.op) {
            case 'refresh':
                this._handleRefresh();
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
    }

    _onLocalChange() {
        this._sendValue();
        this._syncAndEmit(null).done();
    }

    _doOpen() {
        this._feed = this._messaging.getFeed(this._feedId);

        this._feedChangedListener = this._syncAndEmit.bind(this);
        this._feed.on('changed', this._feedChangedListener);

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
    }

    _doClose() {
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = null;
        }

        this.local.removeListener('changed', this._localChangeListener);
        this._feed.removeListener('changed', this._feedChangedListener);
        this._feed.removeListener('incoming-message', this._newMessageListener);

        var keywordlist = [this.local];
        for (var id in this._memberToKeywordMap) {
            if (id === this._feed.ownId)
                continue;
            keywordlist.push(this._memberToKeywordMap[id]);
        }

        return Q.all(keywordlist).then(function(kws) {
            return Q.all(kws.map(function(k) { return k.close(); }));
        }).then(function() {
            return this._feed.close();
        }.bind(this));
    }
}
