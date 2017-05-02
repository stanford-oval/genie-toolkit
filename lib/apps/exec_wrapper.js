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

    _doClone() {
        return new ExecWrapper(this.engine, this.app, this._keywordAsts);
    }

    get icon() {
        var icon;
        if (this.currentChannel && this.currentChannel.device)
            icon = this.currentChannel.device.kind;
        if (!icon)
            icon = this.app.icon;
        return icon;
    }

    notify(messages) {
        var assistant = this.engine.platform.getCapability('assistant');
        if (!assistant)
            return Q.reject('Assistant not supported');
        if (this.app.conversation)
            var conversation = assistant.getConversation(this.app.conversation);
        else
            var conversation = null;
        if (conversation)
            return conversation.notify([this.app.uniqueId, this.icon, messages]);
        else
            return assistant.notifyAll([this.app.uniqueId, this.icon, messages]);
    }

    askQuestion(type, question) {
        var assistant = this.engine.platform.getCapability('assistant');
        if (!assistant)
            return Q.reject('Assistant not supported');
        var conversation = assistant.getConversation(this.app.conversation);
        if (!conversation)
            return Q.reject('User not available to respond');
        return conversation.askQuestion([this.app.uniqueId, this.icon, type, question]);
    }

    stop() {
        return Q.all(this.keywords.map(function(kw) {
            return kw.close();
        }));
    }

    _getInputKeyword(kw) {
        return this.engine.keywords.getOpenedKeyword(this.app.uniqueId, kw);
    }

    start() {
        return Q.all(this._keywordAsts.map(function(kw) {
            return this._getInputKeyword(kw);
        }, this)).then((kws) => {
            this.keywords = kws;
            kws.forEach(function(k) {
                this.addKeyword(k.name, k);
            }.bind(this));
        });
    }
}
