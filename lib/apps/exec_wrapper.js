// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const ExecEnvironment = ThingTalk.ExecEnvironment;
const ChannelOpener = require('./channel_opener');

module.exports = class ExecWrapper extends ExecEnvironment {
    constructor(engine, app, keywordAsts) {
        super(app.state, engine.platform.locale, engine.platform.timezone);
        this.engine = engine;
        this.app = app;

        // apply care in choosing property names to avoid clashes
        // with the parent class ExecEnvironment
        this._keywordAsts = keywordAsts;
        this.keywords = [];
    }

    stop() {
        return Q.try(function() {
            if (this._feed)
                return this._feed.close();
        }.bind(this)).then(function() {
            return Q.all(this.keywords);
        }.bind(this)).then(function(kws) {
            return Q.all(kws.map(function(kw) {
                return kw.close();
            }));
        }.bind(this));
    }

    _getInputKeyword(kw) {
        var compiler = this.app.compiler;

        var scope, feedId;
        var decl = compiler.getKeywordDecl(kw.name);
        if (decl.extern)
            scope = null;
        else
            scope = this.app.uniqueId;
        if (decl.feedAccess)
            feedId = this.app.feedId;
        else
            feedId = null;

        return this.engine.keywords.getOpenedKeyword(scope, kw.name, feedId, kw.owner === 'self');
    }

    start() {
        return Q.try(function() {
            if (this.app.compiler.feedAccess)
                this._feed = this.engine.messaging.getFeed(this.app.feedId);
            else
                this._feed = null;
            if (this._feed !== null)
                return this._feed.open();
        }.bind(this)).then(function() {
            this.keywords = this._keywordAsts.map(function(kw) {
                return this._getInputKeyword(kw);
            }, this);
            return Q.all(this.keywords);
        }.bind(this)).then(function(kws) {
            kws.forEach(function(k) {
                this.addKeyword(k.name, k);
            }.bind(this));
        }.bind(this));
    }
}
