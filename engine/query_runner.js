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
const DeviceSelector = require('./device_selector');

module.exports = new lang.Class({
    Name: 'QueryRunner',
    Extends: events.EventEmitter,
    $rpcMethods: ['start', 'stop'],

    _init: function(engine, app, inputBlocks) {
        this.engine = engine;
        this._running = false;

        this._state = app.state;
        this._blocks = inputBlocks;
        this._inputs = inputBlocks.map(function(input) {
            return new DeviceSelector(this.engine, app, 'r', input);
        }.bind(this));

        this._env = new ExecEnvironment(this.engine, this.engine.devices, this._state);
        this._ready = false;
    },

    get env() {
        return this._env;
    },

    _onData: function(from, data) {
        try {
            this._env.reset();

            if (from)
                console.log('Handling incoming data on ' + from.uniqueId);

            // "sample" the current list of channels based on the devices we
            // see now
            for (var i = 0; i < this._blocks.length; i++)
                this._blocks[i].channels = this._inputs[i].getChannels();

            this._blocks[0].update(this._blocks, 0, this._env, function() {
                console.log('Rule triggered');
                this.emit('triggered', this._env);
            }.bind(this));
        } catch(e) {
            console.log('Error during query run: ' + e.message);
            console.log(e.stack);
        }
    },

    _channelAdded: function(ch) {
        console.log('Connecting to data event on ' + ch.uniqueId);
        ch.on('data', this._dataListener);

        // if this channel was added when the query was already running sample the new data
        // from it
        if (this._ready)
            this._onData();
    },

    _channelRemoved: function(ch) {
        ch.removeListener('data', this._dataListener);
    },

    stop: function() {
        if (!this._running)
            throw new Error('QueryRunner is not running');

        return Q.all(this._inputs.map(function(input) {
            return input.stop();
        }.bind(this)));
    },

    start: function() {
        this._running = true;
        var self = this;
        this._dataListener = function(data) {
            var from = this;
            self._onData(from, data);
        };

        Q.all(this._inputs.map(function(input) {
            input.on('channel-added', this._channelAdded.bind(this));
            input.on('channel-removed', this._channelRemoved.bind(this));

            return input.start();
        }, this)).then(function() {
            console.log('Handling initial channel state sample');
            this._ready = true;
            this._onData();
            this.emit('ready');
        }.bind(this)).done();
    },
});
