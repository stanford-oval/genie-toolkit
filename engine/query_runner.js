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

const AppCompiler = require('./app_compiler');
const AppGrammar = require('./app_grammar');
const ExecEnvironment = require('./exec_environment');
const DeviceSelector = require('./device_selector');

module.exports = new lang.Class({
    Name: 'QueryRunner',
    Extends: events.EventEmitter,
    $rpcMethods: ['start', 'stop'],

    _init: function(engine, app, input) {
        this.engine = engine;
        this._running = false;

        this.app = app;
        this._state = app.state;

        this._trigger = inputs.trigger;
        this._keywords = [];
        this._input = input;

        if (this._trigger)
            this._selector = new DeviceSelector(this.engine, 'r', this._trigger);
        else
            this._selector = null;

        this._env = new ExecEnvironment(this._state);
        this._ready = false;
    },

    _onTriggerData: function(from) {
        console.log('Handling incoming data on ' + from.uniqueId);
        this._env.reset();
        this._env.triggerValue = from.event;

        this._checkQuery();
    },

    _onKeywordChanged: function(keyword, owner) {
        console.log('Handling keyword change on ' + keyword.name);
        this._env.reset();
        this._env.changedKeyword = keyword.name;
        this._env.changedMember = owner;

        this._checkQuery();
    },

    _checkQuery: function() {
        try {
            this._input.caller(this._env, function() {
                this.emit('triggered', this._env);
            });
        } catch(e) {
            console.log('Error during query run: ' + e.message);
            console.log(e.stack);
        }
    },

    _channelAdded: function(ch) {
        console.log('Connecting to data event on ' + ch.uniqueId);
        ch.on('data', this._dataListener);

        // if this channel was added when the query was already running sample the new data
        // from it
        if (this._ready)
            this._onTriggerData(ch);
    },

    _channelRemoved: function(ch) {
        ch.removeListener('data', this._dataListener);
    },

    stop: function() {
        if (!this._running)
            throw new Error('QueryRunner is not running');

        return Q.try(function() {
            if (this._feed)
                return this._feed.stop();
        }.bind(this)).then(function() {
            return Q.all(this._keywords);
        }.bind(this)).then(function(kws) {
            kws.forEach(function(kw) {
                kw.removeListener('changed', this._keywordChangedListener);
            }, this);

            if (this._selector)
                return this._selector.stop();
        }.bind(this));
    },

    _getInputKeyword: function(kw) {
        var compiler = this.app.compiler;

        var scope, name, feedId;
        if (kw.feedAccess)
            feedId = this.app.feedId;
        else
            feedId = null;
        var decl = compiler.getKeywordDecl(kw.name);
        if (decl.extern)
            scope = null;
        else
            scope = app.uniqueId;
        name = kw.name;

        return this.engine.keywords.getKeyword(scope, name, feedId, kw.owner === 'self');
    },

    start: function() {
        this._running = true;
        var self = this;
        this._dataListener = function(data) {
            var from = this;
            self._onTriggerData(from, data);
        };
        this._keywordChangedListener = function(owner) {
            var from = this;
            self._onKeywordChanged(from, owner);
        };

        Q.try(function() {
            if (this.app.feedId) {
                this._feed = this.engine.messaging.getFeed(this.app.feedId);
                return this._feed.open();
            }
        }.bind(this)).then(function() {
            this._keywords = this._input.keywords.map(function(k) {
                return this._getInputKeyword(k);
            });
            return Q.all(this._keywords);
        }.bind(this)).then(function(kws) {
            kws.forEach(function(k) {
                this._env.addKeyword(k.name, k);
            }.bind(this));

            if (this._selector) {
                this._selector.on('channel-added', this._channelAdded.bind(this));
                this._selector.on('channel-removed', this._channelRemoved.bind(this));

                return this._selector.start();
            } else {
                kws.forEach(function(k) {
                    k.on('changed', this._keywordChangedListener);
                }, this);
            }
        }.bind(this)).then(function() {
            console.log('Handling initial keyword/trigger state sample');
            this._ready = true;
            this._onData();
            this.emit('ready');
        }.bind(this)).done();
    },
});
