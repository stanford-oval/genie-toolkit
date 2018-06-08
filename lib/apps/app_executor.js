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

const { OutputQueue, ConversationOutput } = require('./output_queue');

module.exports = class AppExecutor extends events.EventEmitter {
    constructor(engine, code, state, name, description) {
        super();

        this.engine = engine;
        this.state = state;
        this.code = code;

        // set automatically by the engine
        this.isRunning = false;
        this.isEnabled = false;

        var compiler = new AppCompiler();
        compiler.setSchemaRetriever(engine.schemas);
        this.compiler = compiler;

        this.rules = [];
        this.commands = [];

        try {
            this._ast = AppGrammar.parse(code);
            this._error = null;
        } catch(e) {
            this._error = e;
        }

        this.icon = state.$icon || null;
        this.conversation = state.$conversation;

        this.updateNameDescription(name, description);

        this._conversationOutput = new ConversationOutput(this);
        this._mainOutput = new OutputQueue();
        this._finished = false;
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
        else
            this.name = this._ast.name.name;
        if (description)
            this.description = description;
        else if (this.state.description)
            this.description = this.state.description;
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

    compile() {
        if (this._error)
            return Promise.reject(this._error);

        return this.compiler.compileProgram(this._ast);
    }

    runCommands() {
        for (let command of this.commands)
            command.start();

        return Promise.all(this.commands.map((c) => c.waitFinished())).then(() => this._mainOutput.done());
    }

    open() {
        if (this._error)
            return Promise.reject(this._error);

        for (let compiled of this.compiler.rules) {
            if (compiled.hasTrigger)
                this.rules.push(new RuleExecutor(this.engine, this, compiled, this.conversationOutput));
            else
                this.commands.push(new RuleExecutor(this.engine, this, compiled, this.mainOutput));
        }

        this._finishedRules = new Set;
        for (let rule of this.rules) {
            rule.on('finish', () => {
                this._finishedRules.add(rule);
                if (this._finishedRules.size === this.rules.length) {
                    console.log(`All rules in ${this.uniqueId} finished, removing self`);
                    this._finished = true;
                    this.removeSelf();
                }
            });
        }

        return Promise.resolve();
    }

    start() {
        return Promise.all(this.rules.map((r) => r.start()));
    }

    stop() {
        return Promise.all(this.rules.map((r) => r.stop()));
    }

    close() {
        for (let executor of this.rules)
            executor.release();
        for (let executor of this.commands)
            executor.release();
    }
};
module.exports.prototype.$rpcMethods = ['get name', 'get description', 'get icon', 'get code',
                                        'get state', 'get uniqueId', 'get error',
                                        'get isRunning', 'get isEnabled'];
