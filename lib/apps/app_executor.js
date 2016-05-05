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

const AppNotifyChannel = new Tp.ChannelClass({
    Name: 'AppNotifyChannel',

    _init: function(engine, app, removeOnSend) {
        this.parent();
        this.engine = engine;
        this._app = app;

        this._removeOnSend = removeOnSend;
        this._inner = null;
    },

    sendEvent(event) {
        this._inner.sendEvent([this._app.uniqueId, event]);

        if (this._removeOnSend) {
            setTimeout(function() {
                this.engine.apps.removeApp(this._app);
            }.bind(this), 0);
        }
    },

    _doOpen() {
        return this.engine.channels.getNamedPipe('thingengine-app-notify', 'w')
            .then(function(ch) {
                this._inner = ch;
            }.bind(this));
    },

    _doClose() {
        return this._inner.close();
    }
});

const AppInputChannel = new Tp.ChannelClass({
    Name: 'AppInputChannel',
    Extends: Tp.BaseChannel,

    _init: function(engine, app) {
        this.parent();
        this.engine = engine;
        this._app = null;

        this._inner = null;
        this._listener = this._onEvent.bind(this);
    },

    _onEvent: function(data) {
        var app = data[0];
        var event = data[1];
        if (app === this._app.uniqueId)
            this.emitEvent(event);
    },

    _doOpen: function() {
        return this.engine.channels.getNamedPipe('thingengine-app-input', 'r')
            .then(function(ch) {
                this._inner = ch;
                this._inner.on('data', this._listener);
            }.bind(this));
    },

    _doClose: function() {
        this._inner.removeListener('data', this._listener);
        return this._inner.close();
    },
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
                throw new Error("Missing $F parameter for feed shared app");

            this._error = null;
        } catch(e) {
            this._error = e;
        }

        this.uniqueId = 'app-' + this._ast.name.name;
        if (this._ast.name.feedAccess) {
            this.feedId = state['$F'];
            this.uniqueId += this.feedId.replace(/[^a-zA-Z0-9]+/g, '-');
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
            this.description = 'This app has no description';
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

    start() {
        if (this._error)
            return Q.reject(this._error);

        return this.compiler.compileProgram(this._ast, this.state).then(function() {
            this.modules = {};
            for (var name in this.compiler.modules) {
                this.modules[name] = new ComputeModule(this.engine, this, name,
                                                       this.compiler.modules[name]);
            }
            this.rules = this.compiler.rules.map(function(rule) {
                return new RuleExecutor(this.engine, this, rule);
            }, this);

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

    getTrigger(id) {
        var channel;
        switch (id) {
        case 'input':
            channel = new AppInputChannel(this.engine, this);
            break;
        default:
            throw new Error('Invalid channel name ' + id);
        }

        return channel.open().then(function() { return channel; });
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
            throw new Error(this.uniqueId + ' is not a feed shared app');

        var feed = this.engine.messaging.getFeed(this.feedId);
        return feed.open().then(function() {
            var feedIdBase64 = (new Buffer(feed.feedId)).toString('base64');
            var url = 'https://thingengine.stanford.edu/apps/shared/' + this.engine.platform.getCloudId() + '/' + this._ast.name.name + '/' + feedIdBase64;
            return feed.sendRaw({ type: 'rdl', noun: 'app',
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
