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
const ExecEnvironment = require('./exec_environment');
const QueryRunner = require('./query_runner');
const DeviceSelector = require('./device_selector');
const ComputeModule = require('./compute_module');
const TableDevice = require('./table');

const RuleExecutor = new lang.Class({
    Name: 'RuleExecutor',

    _init: function(engine, app, rule) {
        this.engine = engine;
        this.app = app;

        this.input = new QueryRunner(engine, this.app, rule.inputs);
        this.input.on('triggered', this._onTriggered.bind(this));

        this.outputs = rule.outputs.map(function(output) {
            return {
                block: output,
                selector: new DeviceSelector(engine, this.app, 'w', output),
            };
        }, this);
    },

    _onTriggered: function(env) {
        this.outputs.forEach(function(output) {
            env.beginOutput();
            output.block.action(env);
            var out = env.finishOutput();

            var channels = output.selector.getChannels();
            channels.forEach(function(channel) {
                channel.sendEvent(out);
            });
        });
    },

    start: function() {
        this.input.start();

        Q.all(this.outputs.map(function(output) {
            return output.selector.start();
        })).done();

        return Q();
    },

    stop: function() {
        return this.input.stop().then(function() {
            return Q.all(this.outputs.map(function(output) {
                return output.selector.stop();
            }));
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

        try {
            var compiler = new AppCompiler();
            var ast = AppGrammar.parse(code);

            // FIXME
            compiler.compileAtRules([]);
            compiler.compileProgram(ast);

            this.uniqueId = 'app-' + compiler.programName;
            var paramnames = Object.keys(compiler.params);
            paramnames.forEach(function(name) {
                var type = compiler.params[name];
                if (type.isObject || type.isGroup)
                    this.uniqueId += '-' + state[name];
                else if (type.isLocation)
                    this.uniqueId += '-' + state[name].x + '-' + state[name].y;
                else
                    this.uniqueId += '-' + state[name];
            }, this);

            var modulenames = Object.keys(compiler.modules);
            this.modules = modulenames.map(function(name) {
                return new ComputeModule(engine, this, name, compiler.modules[name]);
            }, this);
            var tablenames = Object.keys(compiler.tables);
            this.tables = tablenames.map(function(name) {
                return new TableDevice(engine, this, name, compiler.tables[name]);
            }, this);
            this.rules = compiler.rules.map(function(rule) {
                return new RuleExecutor(engine, this, rule);
            }, this);

            this.data = this.modules.concat(this.tables);

            this.name = compiler.name;
            this.description = compiler.description;
            this.settings = compiler.settings;

            this.isBroken = false;
        } catch(e) {
            console.log('App is broken: ' + e.message);
            console.log(e.stack);
            this.isBroken = true;
            this.name = 'Broken App';
            this.description = 'This app is broken';
            this.settings = {};
        }
    },

    start: function() {
        Q.all(this.data.map(function(m) { return m.start(); })).then(function() {
            return Q.all(this.rules.map(function(r) { return r.start(); }));
        }.bind(this)).done();

        return Q();
    },

    stop: function() {
        return Q.all(this.rules.map(function(r) { return r.stop() ; }).
                     concat(this.data.map(function(m) { return m.stop(); })));
    },
});
