// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const events = require('events');

const ThingTalk = require('thingtalk');
const AppGrammar = ThingTalk.Grammar;
const AppCompiler = ThingTalk.Compiler;
const RuleExecutor = require('./rule_executor');
const { ChannelState } = require('../db/channel');

const { OutputQueue, ConversationOutput } = require('./output_queue');

module.exports = class AppExecutor extends events.EventEmitter {
    constructor(engine, code, meta, name, description) {
        super();

        this.engine = engine;

        this.code = code;

        // set automatically by the engine
        this.isRunning = false;
        this.isEnabled = false;

        this.compiler = new AppCompiler(engine.schemas);
        this.command = null;
        this.rules = [];

        try {
            this._ast = AppGrammar.parse(code);
            this._error = null;
        } catch(e) {
            this._error = e;
        }

        this._meta = meta;
        this.icon = meta.$icon || null;
        this.conversation = meta.$conversation;

        this.updateNameDescription(name, description);

        this._conversationOutput = new ConversationOutput(this);
        this._mainOutput = new OutputQueue();
        this._finished = false;

        this._states = [];
    }

    get metadata() {
        return this._meta;
    }

    get mainOutput() {
        return this._mainOutput;
    }
    get conversationOutput() {
        return this._conversationOutput;
    }

    getConversation() {
        var assistant = this.engine.platform.getCapability('assistant');
        if (!assistant)
            throw new Error('Assistant not supported');
        if (this.conversation)
            return assistant.getConversation(this.conversation);
        else
            return null;
    }

    updateNameDescription(name, description) {
        if (name)
            this.name = name;
        if (description)
            this.description = description;
        else if (this._meta.description)
            this.description = this._meta.description;
        else
            this.description = this.engine._("This app has no description");
    }

    get error() {
        if (this._error)
            return this._error.message || this._error;
        else
            return null;
    }
    set error(e) {
        this._error = e;
    }
    reportError(error) {
        this._error = error;
        return this._conversationOutput.error(this.icon, error);
    }

    destroy() {
        if (this._finished)
            return Promise.resolve();

        // FINISHME send AbortProgram to the source (if any)
        return Promise.resolve();
    }

    removeSelf() {
        this.engine.apps.removeApp(this);
    }

    async compile() {
        if (this._error)
            throw this._error;

        const compiled = await this.compiler.compileProgram(this._ast);

        if (compiled.command)
            this.command = new RuleExecutor(this.engine, this, compiled.command, this._mainOutput);

        this._finishedRules = new Set;
        for (let rule of compiled.rules) {
            const executor = new RuleExecutor(this.engine, this, rule, this._conversationOutput);
            this.rules.push(executor);
            executor.on('finish', () => {
                this._finishedRules.add(executor);
                if (this._finishedRules.size === this.rules.length) {
                    console.log(`All rules in ${this.uniqueId} finished, removing self`);
                    this._finished = true;
                    this.removeSelf();
                }
            });
        }
    }

    async runCommand() {
        if (this.command) {
            this.command.start();
            await this.command.waitFinished();
        }
        await this._mainOutput.done();
    }
    waitFinished() {
        const promises = this.command ? [this.command.waitFinished()] : [];
        promises.push(...this.rules.map((r) => r.waitFinished()));
        return Promise.all(promises);
    }

    _getState(stateId) {
        if (!this._states[stateId])
            this._states[stateId] = new ChannelState(this.engine.platform, 'app:' + this.uniqueId + ':' + stateId);
        return this._states[stateId];
    }

    readState(stateId) {
        return this._getState(stateId).read();
    }
    writeState(stateId, state) {
        return this._getState(stateId).write(state);
    }

    start() {
        return Promise.all(this.rules.map((r) => r.start()));
    }

    stop() {
        return Promise.all(this.rules.map((r) => r.stop()));
    }
};
module.exports.prototype.$rpcMethods = ['get name', 'get description', 'get icon', 'get code',
                                        'get uniqueId', 'get error',
                                        'get isRunning', 'get isEnabled'];
