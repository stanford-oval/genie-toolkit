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

module.exports = new lang.Class({
    Name: 'ExecEnvironment',

    _init: function(appstate) {
        this._state = appstate;
        this._keywords = {};
        this._feed = null;
        this.reset();
    },

    addKeyword: function(name, keyword) {
        this._keywords[name] = keyword;
    },

    reset: function() {
        this.triggerValue = null;
        this.changedMember = null;
        this.changedKeyword = null;
        // self is always member 0 in the list
        if (this._feed !== null)
            this._scope = { self: this.readFeedMember(0) };
        else
            this._scope = {};
        this._memberBindings = { self: 0 };
    },

    getFeedMembers: function() {
        return this._feed.getMembers();
    },

    setMemberBinding: function(name, member) {
        if (typeof member !== 'number' ||
            member < 0 || member >= this._feed.getMembers().length)
            throw new TypeError('Invalid member binding value ' + member + ' for ' + name);
        this._memberBindings[name] = member;
    },

    getMemberBinding: function(name) {
        if (this._memberBindings[name] === undefined)
            throw new TypeError('Invalid member binding ' + name);
        return this._memberBindings[name];
    },

    setFeed: function(feed) {
        this._feed = feed;
    },

    readFeed: function() {
        return this._feed;
    },

    readFeedMember: function(user) {
        return this._feed.getMembers()[user];
    },

    setVar: function(name, value) {
        this._scope[name] = value;
    },

    readKeyword: function(name) {
        return this._keywords[name].value;
    },

    readVar: function(name) {
        if (this._scope[name] !== undefined)
            return this._scope[name];
        if (this._state[name] !== undefined)
            return this._state[name];
        throw new TypeError("Unknown variable " + name);
    },

    readObjectProp: function(object, name) {
        var v = object[name];
        if (v === undefined)
            throw new TypeError('Object ' + object + ' has no property ' + name);
        return v;
    }
});
