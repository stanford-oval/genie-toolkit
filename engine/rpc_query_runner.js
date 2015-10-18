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

module.exports = new lang.Class({
    Name: 'ManualQueryRunner',
    $rpcMethods: ['runQuery'],

    _init: function(engine) {
        this.engine = engine;
    },

    runQuery: function(code, state, handler) {
        var compiler = new AppCompiler();
        var ast = AppGrammar.parse(code, { startRule: 'query' });

        var runner = new QueryRunner(this.engine, state, compiler.compileInputs(ast));

        runner.on('triggered', function(env) {
            handler.triggered(env.getAllAliases());
        });

        return runner;
    },
});
