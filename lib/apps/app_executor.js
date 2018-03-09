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

const Q = require('q');
const events = require('events');
const Tp = require('thingpedia');

const ThingTalk = require('thingtalk');
const AppGrammar = ThingTalk.Grammar;
const AppCompiler = ThingTalk.Compiler;
const RuleExecutor = require('./rule_executor');

const { OutputQueue, ConversationOutput } = require('./output_queue');

class AppTimerChannel extends Tp.PollingTrigger {
    static get requiredCapabilities() {
        return ['channel-state'];
    }

    constructor(engine, state, app, params) {
        super(engine, state, app);

        this.interval = params[0];
        if (typeof this.interval !== 'number' || isNaN(params[0]))
            throw new Error('Missing or invalid parameter for @$timer');
        this.precise = true;

        this.filterString = 'interval-' + this.interval;
    }

    formatEvent(event) {
        var interval = event[0];

        return this.engine._("Timer Elapsed");
    }

    _onTick() {
        var event = [this.interval];
        console.log('Emitting timer event', event);
        this.emitEvent(event);
    }
}

class MemoryNewRecordChannel extends Tp.PollingTrigger {
    static get requireCapabilities() {
        return ['channel-state'];
    }

    constructor(engine, state, app, params) {
        super(engine, state, app);
        this.state = state;
        this.params = params;
    }

    formatEvent(event) {
        let formatted = 'New reocord added to table ' + event[0]
        formatted += event[1].join(', ');
        return formatted;
    }

    _onTick() {
        this.engine.memory.on('new-record-added', (table, version, data) => {
            this.emitEvent([table, data]);
        });
    }
}

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

        try {
            this._ast = AppGrammar.parse(code);
            this._error = null;
        } catch(e) {
            this._error = e;
        }

        // AppExecutor pretends to be a BaseDevice to handle timers
        // so we must provide the `kind` property, which ExecEnvironment
        // uses to construct output types
        this.kind = 'org.thingpedia.builtin.thingengine.builtin';
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

    get ownerTier() {
        // apps are not synchronized
        return this.engine.ownTier;
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
        if (this._error === null)
            return null;
        else
            return this._error.message;
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
            return Q();

        // FINISHME send AbortProgram to the source (if any)
        return Q();
    }

    removeSelf() {
        this.engine.apps.removeApp(this);
    }

    compile() {
        if (this._error)
            return Q.reject(this._error);

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

        this.rules = [];
        this.commands = [];

        for (let compiled of this.compiler.rules) {
            let functions = compiled.functions;
            let hasTrigger = functions.length > 0 && functions[0].type === 'trigger';
            if (hasTrigger)
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
        return Q.all(this.rules.map((r) => r.start()));
    }

    stop() {
        return Q.all(this.rules.map((r) => r.stop()));
    }

    close() {
        for (let executor of this.rules)
            executor.release();
        for (let executor of this.commands)
            executor.release();
    }

    getActionClass(id) {
        throw new Error('Invalid action name ' + id);
    }
    getTriggerClass(id) {
        switch (id) {
            case 'timer':
                return AppTimerChannel;
            case 'new_record':
                return MemoryNewRecordChannel;
            default:
                throw new Error('Invalid trigger name ' + id);
        }
    }
    getQueryClass(id) {
        throw new Error('Invalid query name ' + id);
    }

    getAction(id) {
        return this.engine.channels.getOpenedChannel(this, id, 'w');
    }
    getQuery(id) {
        return this.engine.channels.getOpenedChannel(this, id, 'q');
    }
    getTrigger(id, params) {
        return this.engine.channels.getOpenedChannel(this, id, 'r', params);
    }
};
module.exports.prototype.$rpcMethods = ['get name', 'get description', 'get icon', 'get code',
                                        'get state', 'get uniqueId', 'get error',
                                        'get isRunning', 'get isEnabled'];
