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
        this.uniqueId = undefined;
        this.currentTier = undefined;
        this.isRunning = false;
        this.isEnabled = false;

        try {
            var compiler = new AppCompiler();
            var ast = AppGrammar.parse(code);

            compiler.compileAtRules(ast['at-rules']);

            this.name = compiler.name;
            this.description = compiler.description;
            this.settings = compiler.settings;

            this.input = new QueryRunner(engine, this.state, compiler, compiler.compileInputs(ast.inputs, state));
            this.input.on('triggered', this._onTriggered.bind(this));

            this.outputs = compiler.compileOutputs(ast.outputs).map(function(output) {
                return {
                    block: output,
                    selector: new DeviceSelector(engine, 'w', output, compiler, state)
                };
            });

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
