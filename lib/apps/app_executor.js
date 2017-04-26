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
const ComputeModule = require('./compute_module');
const RuleExecutor = require('./rule_executor');
const CommandExecutor = require('./command_executor');

const AppNotifyChannel = new Tp.ChannelClass({
    Name: 'AppNotifyChannel',
    RequiredCapabilities: ['assistant'],

    _init: function(engine, app) {
        this.parent(engine, app);
        this.engine = engine;
        this._app = app;

        this.removeOnSend = false;
    },

    sendEvent(event, env) {
        var formatted;
        try {
            if (event.length > 0) {
                formatted = event.join(', ');
            } else {
                formatted = env.formatEvent('messages');
            }
        } catch(e) {
            console.error('Failed to format event: ' + e.message);
            this._app.reportError(e);
        }

        var icon;
        if (env.currentChannel && env.currentChannel.device)
            icon = env.currentChannel.device.kind;
        if (!icon)
            icon = this._app.icon;

        var assistant = this.engine.platform.getCapability('assistant');
        if (this._app.conversation)
            var conversation = assistant.getConversation(this._app.conversation);
        else
            var conversation = null;
        if (conversation)
            conversation.notify([this._app.uniqueId, icon, formatted]);
        else
            assistant.notifyAll([this._app.uniqueId, icon, formatted]);

        if (this.removeOnSend) {
            setImmediate(() => {
                this._app.removeSelf();
            });
        }
    }
});

const AppReturnChannel = new Tp.ChannelClass({
    Name: 'AppNotifyChannel',
    Extends: AppNotifyChannel,
    RequiredCapabilities: ['assistant'],

    _init(engine, app) {
        this.parent(engine, app);
        this.removeOnSend = true;
    }
});

const AppTimerChannel = new Tp.ChannelClass({
    Name: 'TimerChannel',
    Extends: Tp.PollingTrigger,
    RequiredCapabilities: ['channel-state'],

    _init: function(engine, state, app, params) {
        this.parent(engine, state, app);

        this.interval = params[0];
        if (typeof this.interval !== 'number')
            throw new Error('Missing or invalid parameter for @$timer');
        this.precise = true;

        this.filterString = 'interval-' + this.interval;
    },

    formatEvent(event) {
        var interval = event[0];

        return this.engine._("Timer Elapsed");
    },

    _onTick: function() {
        var event = [this.interval];
        console.log('Emitting timer event', event);
        this.emitEvent(event);
    },
});

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
            conversation.notifyError([this.uniqueId, this.icon, error]);
        else
            assistant.notifyErrorAll([this.uniqueId, this.icon, error]);
    }

    removeSelf() {
        this.engine.apps.removeApp(this);
    }

    compile() {
        if (this._error)
            return Q.reject(this._error);

        return this.compiler.compileProgram(this._ast, this.state);
    }

    runCommands() {
        return Q.all(this.commands.map((c) => c.run()));
    }

    open() {
        if (this._error)
            return Q.reject(this._error);

        this.modules = {};
        for (var name in this.compiler.modules) {
            this.modules[name] = new ComputeModule(this.engine, this, name,
                                                   this.compiler.modules[name]);
        }
        this.rules = this.compiler.rules.map(function(rule) {
            return new RuleExecutor(this.engine, this, rule);
        }, this);
        this.commands = this.compiler.commands.map(function(command) {
            return new CommandExecutor(this.engine, this, command);
        }, this);

        return Q.try(function() {
            var modulenames = Object.keys(this.modules);
            return Q.all(modulenames.map(function(name) {
                return this.modules[name].start();
            }, this)).then(function() {
                return Q.all(this.rules.map(function(r) { return r.open(); }));
            }.bind(this));
        }.bind(this)).catch(function(e) {
            this._error = e;
            throw e;
        }.bind(this));
    }

    start() {
        return Q.all(this.rules.map(function(r) { return r.start(); }));
    }

    stop() {
        return Q.all(this.rules.map(function(r) { return r.stop(); }));
    }

    close() {
        return Q.all(this.rules.map(function(r) { return r.close() ; }))
            .then(function() {
                var modulenames = Object.keys(this.modules);
                return Q.all(modulenames.map(function(name) {
                    return this.modules[name].stop();
                }, this));
            }.bind(this));
    }

    hasComputeModule(name) {
        return !!this.modules[name];
    }

    getComputeModule(name) {
        return this.modules[name];
    }

    getActionClass(id) {
        switch (id) {
        case 'return':
            return AppReturnChannel;
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
