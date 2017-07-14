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
const Tp = require('thingpedia');

const ThingTalk = require('thingtalk');
const AppGrammar = ThingTalk.Grammar;
const AppCompiler = ThingTalk.Compiler;
const RuleExecutor = require('./rule_executor');
const CommandExecutor = require('./command_executor');

class AppNotifyChannel extends Tp.BaseChannel {
    static get requiredCapabilities() {
        return ['assistant'];
    }

    sendEvent([outputType, currentEvent], env) {
        return env.output(outputType, currentEvent, env.currentChannel);
    }
}

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

        this.icon = state.$icon || null;
        this.conversation = state.$conversation;

        this.updateNameDescription(name, description);
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

    reportError(error) {
        this._error = error;

        var assistant = this.engine.platform.getCapability('assistant');
        if (this.conversation)
            var conversation = assistant.getConversation(this.conversation);
        else
            var conversation = null;
        if (conversation)
            conversation.notifyError(this.uniqueId, this.icon, error);
        else
            assistant.notifyErrorAll(this.uniqueId, this.icon, error);
    }

    destroy() {
        return Q.all([
            Q.all(this.rules.map((r) => r.destroy())),
            Q.all(this.commands.map((c) => c.destroy()))
        ]);
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
        return Q.all(this.commands.map((c) => c.run()));
    }

    open() {
        if (this._error)
            return Q.reject(this._error);

        this.rules = [];
        this.commands = [];
        this.compiler.rules.forEach((rule) => {
            if (rule.isRule)
                this.rules.push(new RuleExecutor(this.engine, this, rule));
            else
                this.commands.push(new CommandExecutor(this.engine, this, rule));
        });

        return Q.all(this.rules.map((r) => r.open())).catch((e) => {
            this._error = e;
            throw e;
        });
    }

    start() {
        return Q.all(this.rules.map((r) => r.start()));
    }

    stop() {
        return Q.all(this.rules.map((r) => r.stop()));
    }

    close() {
        return Q.all(this.rules.map((r) => r.close()));
    }

    getActionClass(id) {
        switch (id) {
        case 'notify':
            return AppNotifyChannel;
        default:
            throw new Error('Invalid action name ' + id);
        }
    }
    getTriggerClass(id) {
        switch (id) {
        case 'timer':
            return AppTimerChannel;
        default:
            throw new Error('Invalid trigger name ' + id);
        }
    }
    getQueryClass(id) {
        switch (id) {
        default:
            throw new Error('Invalid query name ' + id);
        }
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
}
module.exports.prototype.$rpcMethods = ['get name', 'get description', 'get icon', 'get code',
                                        'get state', 'get uniqueId', 'get error',
                                        'get isRunning', 'get isEnabled'];
