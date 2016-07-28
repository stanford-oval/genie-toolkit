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

    _init: function(engine, app, removeOnSend) {
        this.parent();
        this.engine = engine;
        this._app = app;

        // for debugging and for ObjectSet
        this.uniqueId = app.uniqueId + '-notify';

        this._removeOnSend = removeOnSend;
    },

    sendEvent(event, env) {
        var formatted;

        if (event.length > 0) {
            formatted = event.join(', ');
        } else {
            var currentChannel = env.currentChannel;

            if (currentChannel === null)
                formatted = '';
            else if (env.queryInput !== null)
                formatted = currentChannel.formatEvent(env.queryValue, env.queryInput);
            else
                formatted = currentChannel.formatEvent(env.triggerValue);
        }

        this.engine.platform.getCapability('assistant').notify([this._app.uniqueId, formatted]);

        if (this._removeOnSend) {
            setImmediate(() => {
                this._app.removeSelf();
            });
        }
    }
});

module.exports = class AppExecutor extends events.EventEmitter {
    constructor(engine, code, state, name, description) {
        super();

        this.engine = engine;
        this.state = state;
        this.code = code;

        // set automatically by the engine
        this.currentTier = undefined;
        this.isRunning = false;
        this.isEnabled = false;

        var compiler = new AppCompiler();
        compiler.setSchemaRetriever(engine.schemas);
        this.compiler = compiler;

        try {
            this._ast = AppGrammar.parse(code);

            if (!state['$F'] && this._ast.name.feedAccess)
                throw new Error(this.engine._("Missing $F parameter for feed shared app"));

            this._error = null;
        } catch(e) {
            this._error = e;
        }

        if (this._ast.name.feedAccess) {
            this.feedId = state['$F'];
        } else {
            this.feedId = null;
        }

        this.updateNameDescription(name, description);
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
    }

    removeSelf() {
        this.engine.apps.removeApp(this);
    }

    compile() {
        if (this._error)
            return Q.reject(this._error);

        return this.compiler.compileProgram(this._ast, this.state).then(() => {
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
        });
    }

    runCommands() {
        return Q.all(this.commands.map((c) => c.run()));
    }

    start() {
        if (this._error)
            return Q.reject(this._error);

        return Q.try(function() {
            var modulenames = Object.keys(this.modules);
            return Q.all(modulenames.map(function(name) {
                return this.modules[name].start();
            }, this)).then(function() {
                return Q.all(this.rules.map(function(r) { return r.start(); }));
            }.bind(this));
        }.bind(this)).catch(function(e) {
            this._error = e;
            throw e;
        }.bind(this));
    }

    stop() {
        return Q.all(this.rules.map(function(r) { return r.stop() ; }))
            .then(function() {
                var modulenames = Object.keys(this.modules);
                return Q.all(modulenames.map(function(name) {
                    return this.modules[name].start();
                }, this));
            }.bind(this));
    }

    getComputeModule(name) {
        return this.modules[name];
    }

    getAction(id) {
        var channel;
        switch (id) {
        case 'return':
            channel = new AppNotifyChannel(this.engine, this, true);
            break;
        case 'notify':
            channel = new AppNotifyChannel(this.engine, this, false);
            break;
        default:
            throw new Error('Invalid action name ' + id);
        }

        return channel.open().then(function() { return channel; });
    }

    shareYourSelf() {
        if (this.feedId === null)
            throw new Error(this.engine._("%s is not a feed shared app").format(this.uniqueId));

        var feed = this.engine.messaging.getFeed(this.feedId);
        return feed.open().then(function() {
            var feedIdBase64 = (new Buffer(feed.feedId)).toString('base64');
            var url = 'https://thingengine.stanford.edu/apps/shared/' + this.engine.platform.getCloudId() + '/' + this.uniqueId + '/' + feedIdBase64;
            return feed.sendRaw({ type: 'rdl', noun: "app",
                                  displayTitle: this.name,
                                  displayText: this.description,
                                  callback: url,
                                  webCallback: url });
        }.bind(this)).finally(function() {
            feed.close();
        });
    }

    get hasOutVariables() {
        return Object.keys(this.compiler.outs).length > 0;
    }

    pollOutVariables() {
        return Q.all(Object.keys(this.compiler.outs).map(function(out) {
            var keyword = this.compiler.getKeywordDecl(out);

            var scope, name, feedId;
            if (keyword.feedAccess)
                feedId = this.feedId;
            else
                feedId = null;
            if (keyword.extern)
                scope = null;
            else
                scope = this.uniqueId;
            name = out;

            return this.engine.keywords.getOpenedKeyword(scope, name, feedId, false).then(function(kw) {
                return { keyword: kw,
                         feedAccess: keyword.feedAccess,
                         type: keyword.type };
            });
        }.bind(this))).then(function(kws) {
            return Q.try(function() {
                return kws.map(function(kw) {
                    return {
                        name: kw.keyword.name,
                        type: kw.type.toString(),
                        feedAccess: kw.feedAccess,
                        value: kw.keyword.value
                    }
                });
            }).finally(function() {
                return Q.all(kws.map(function(kw) {
                    return kw.keyword.close();
                }));
            });
        });
    }
}
module.exports.prototype.$rpcMethods = ['get name', 'get description', 'get code',
                                        'get state', 'get uniqueId', 'get error',
                                        'get currentTier', 'get isRunning', 'get isEnabled',
                                        'shareYourSelf', 'get hasOutVariables', 'pollOutVariables'];
