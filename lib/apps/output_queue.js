// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const adt = require('adt');
const ThingTalk = require('thingtalk');
const AsyncQueue = require('consumer-queue');

const QueueItem = adt.data({
    Notification: {
        icon: adt.only(String, null),
        outputType: adt.only(String, null),
        outputValue: adt.any,
    },
    Error: {
        icon: adt.only(String, null),
        error: adt.any
    },
    Question: {
        icon: adt.only(String, null),
        type: adt.only(ThingTalk.Type),
        question: adt.only(String),
    },
    Done: null
});

class OutputQueue {
    constructor() {
        this._storage = new AsyncQueue();
    }

    next() {
        return this._storage.pop();
    }

    _pushQueueItem(item) {
        let resolve, reject;
        let promise = new Promise((callback, errback) => {
            resolve = callback;
            reject = errback;
        });
        this._storage.push({ item, resolve, reject });
        return promise;
    }

    done() {
        this._pushQueueItem(QueueItem.Done);
    }

    error(icon, error) {
        return this._pushQueueItem(new QueueItem.Error(icon, error));
    }

    output(icon, outputType, outputValues) {
        return this._pushQueueItem(new QueueItem.Notification(icon, outputType, outputValues));
    }

    say(icon, message) {
        return this._pushQueueItem(new QueueItem.Notification(icon, null, message));
    }

    askQuestion(icon, type, question) {
        return this._pushQueueItem(new QueueItem.Question(icon, type, question));
    }
}

class ConversationOutput {
    constructor(app) {
        this.app = app;
        this.engine = app.engine;
    }

    error(icon, error) {
        var assistant = this.engine.platform.getCapability('assistant');
        var conversation = this.app.getConversation();
        if (conversation)
            conversation.notifyError(this.app.uniqueId, icon, error);
        else
            assistant.notifyErrorAll(this.app.uniqueId, icon, error);
    }

    output(icon, outputType, outputValues) {
        var assistant = this.engine.platform.getCapability('assistant');
        var conversation = this.app.getConversation();
        if (conversation)
            return conversation.notify(this.app.uniqueId, icon, outputType, outputValues);
        else
            return assistant.notifyAll(this.app.uniqueId, icon, outputType, outputValues);
    }

    say(icon, message) {
        var assistant = this.engine.platform.getCapability('assistant');
        var conversation = this.app.getConversation();
        if (conversation)
            return conversation.notify(this.app.uniqueId, icon, null, [message]);
        else
            return assistant.notifyAll(this.app.uniqueId, icon, null, [message]);
    }

    askQuestion(icon, type, question) {
        var conversation = this.app.getConversation();
        if (!conversation)
            return Promise.reject(this.engine._("User not available to respond"));
        return conversation.askQuestion(this.app.uniqueId, icon, type, question);
    }
}

module.exports = { ConversationOutput, OutputQueue };
