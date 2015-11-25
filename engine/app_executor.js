// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const lang = require('lang');
const adt = require('adt');

const AppCompiler = require('./app_compiler');
const AppGrammar = require('./app_grammar');
const QueryRunner = require('./query_runner');
const DeviceSelector = require('./device_selector');
const ComputeModule = require('./compute_module');

const RuleExecutor = new lang.Class({
    Name: 'RuleExecutor',

    _init: function(engine, app, rule) {
        this.engine = engine;
        this.app = app;

        this.input = new QueryRunner(engine, this.app, rule.inputs);
        this.input.on('triggered', this._onTriggered.bind(this));

        this.output = rule.output;

        if (this.output.action)
            this.selector = new DeviceSelector(engine, this.app, 'w', this.output.action);
        else
            this.selector = null;
    },

    _onTriggered: function(env) {
        var value = this.output.produce(env);

        if (this.selector) {
            this.selector.getChannels().forEach(function(channel) {
                channel.sendEvent(value);
            });
        } else {
            var owner = this.output.owner;

            this._outputKeyword.then(function(kw) {
                if (owner === null)
                    kw.changeValue(value);
                else
                    kw.changeValue(value, env.getMemberBinding(owner));
            });
        }
    },

    _getOutputKeyword: function() {
        var compiler = this.app.compiler;

        var scope, name, feedId;
        if (this.output.keyword.feedAccess)
            feedId = this.app.feedId;
        else
            feedId = null;
        var decl = compiler.getKeywordDecl(this.output.keyword.name);
        if (decl.extern)
            scope = null;
        else
            scope = this.app.uniqueId;
        name = this.output.keyword.name;

        return this.engine.keywords.getKeyword(scope, name, feedId, this.output.owner === 'self');
    },

    start: function() {
        this.input.start();

        if (this.selector) {
            this.selector.start().done();
        } else {
            this._outputKeyword = this._getOutputKeyword();
            this._outputKeyword.done();
        }

        return Q();
    },

    stop: function() {
        return this.input.stop().then(function() {
            if (this.selector) {
                return this.selector.stop();
            } else {
                return this._outputKeyword.then(function(kw) {
                    return kw.close();
                });
            }
        }.bind(this));
    },
});

module.exports = new lang.Class({
    Name: 'AppExecutor',
    Extends: events.EventEmitter,
    $rpcMethods: ['get name', 'get description', 'get code',
                  'get state', 'get settings', 'get uniqueId',
                  'get currentTier', 'get isRunning', 'get isEnabled'],

    _init: function(engine, code, state) {
        events.EventEmitter.call(this);

        this.engine = engine;
        this.state = state;
        this.code = code;

        // set automatically by the engine
        this.currentTier = undefined;
        this.isRunning = false;
        this.isEnabled = false;

        var compiler = new AppCompiler();
        this.compiler = compiler;

        try {
            var ast = AppGrammar.parse(code);

            compiler.compileProgram(ast, state);

            this.isBroken = false;
        } catch(e) {
            console.log('App is broken: ' + e.message);
            console.log(e.stack);
            this.isBroken = true;
            this.description = 'This app is broken';
        }

        this.uniqueId = 'app-' + compiler.name;
        if (compiler.feedAccess) {
            this.feedId = state['$F'];
            this.uniqueId += feedId.replace(/[^a-zA-Z0-9]+/g, '-');
        } else {
            this.feedId = null;
        }

        if (!this.isBroken) {
            this.modules = {};
            for (var name in compiler.modules) {
                this.modules[name] = new ComputeModule(engine, this, name, compiler.modules[name]);
            }
            this.rules = compiler.rules.map(function(rule) {
                return new RuleExecutor(engine, this, rule);
            }, this);
        } else {
            this.modules = {};
            this.rules = [];
        }

        this.name = compiler.name;
        this.description = 'This app has no description';
    },

    getComputeModule: function(name) {
        return this.modules[name];
    },

    start: function() {
        var modulenames = Object.keys(this.modules);
        Q.all(modulenames.map(function(name) {
            return this.modules[name].start();
        }, this)).then(function() {
            return Q.all(this.rules.map(function(r) { return r.start(); }));
        }.bind(this)).done();

        return Q();
    },

    stop: function() {
        return Q.all(this.rules.map(function(r) { return r.stop() ; }))
            .then(function() {
                var modulenames = Object.keys(this.modules);
                return Q.all(modulenames.map(function(name) {
                    return this.modules[name].start();
                }, this));
            }.bind(this));
    }
});
