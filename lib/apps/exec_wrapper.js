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
    constructor(engine, app) {
        super(app.state, engine.platform.locale, engine.platform.timezone);
        this.engine = engine;
        this.app = app;
    }

    _doClone() {
        return new ExecWrapper(this.engine, this.app);
    }

    get icon() {
        var icon;
        if (this.currentChannel && this.currentChannel.device)
            icon = this.currentChannel.device.kind;
        if (!icon)
            icon = this.app.icon;
        return icon;
    }

    getConversation() {
        var assistant = this.engine.platform.getCapability('assistant');
        if (!assistant)
            return Q.reject('Assistant not supported');
        if (this.app.conversation)
            return assistant.getConversation(this.app.conversation);
        else
            return null;
    }

    notify(messages) {
        var assistant = this.engine.platform.getCapability('assistant');
        var conversation = this.getConversation();
        if (conversation)
            return conversation.notify([this.app.uniqueId, this.icon, messages]);
        else
            return assistant.notifyAll([this.app.uniqueId, this.icon, messages]);
    }

    askQuestion(type, question) {
        var conversation = this.getConversation();
        if (!conversation)
            return Q.reject(this.engine._("User not available to respond"));
        return conversation.askQuestion([this.app.uniqueId, this.icon, type, question]);
    }
}
