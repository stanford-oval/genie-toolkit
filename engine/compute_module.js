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

const BaseChannel = require('./base_channel');
const BaseDevice = require('./base_device');

const ComputeModuleFunctionChannel = new lang.Class({
    Name: 'ComputeModuleFunctionChannel',
    Extends: BaseChannel,

    _init: function(fn) {
        this.parent();

        this._fn = fn;
    },

    sendEvent: function(event) {
        var args = Object.keys(ast.params).map(function(name) { return event[name]; });
        this._fn.apply(null, args);
    }
});

module.exports = new lang.Class({
    Name: 'ComputeModule',
    Extends: BaseDevice,

    _init: function(engine, app, name, module) {
        this.parent(engine, { kind: 'thingengine-compute-module' });
        this.engine = engine;
        this.app = app;

        this.uniqueId = 'thingengine-compute-module-' + app.uniqueId + '-' + name;
        // this device is stored in AppDatabase not DeviceDatabase
        this.isTransient = true;

        this._name = name;
        this._module = module;

        var scope = {};

        var states = Object.keys(module.state);
        if (states.length === 0)
            var scopestring = '';
        else
            var scopestring = 'var ' + states.join(',') + ';'

        var events = Object.keys(module.events);
        var eventarsgs = events.join(',');
        var eventFunctions = events.map(function(name) {
            var event = module.events[name];
            return (function() {
                var i = 0;
                var data = {};
                for (var name in event)
                    data[name] = arguments[i++];
                return this._emitEvent(name, data);
            }).bind(this);
        }, this);

        this._functions = {};
        this._eventPipes = {};

        for (var name in module.functions) {
            var ast = module.functions[name];
            // this is really evil...
            var outerfn = new Function(events.join(','), scopestring +
                                       'return function(' + Object.keys(ast.params).join(',')
                                       +') {' + ast.code + '};');
            var fn = outerfn.apply(null, eventFunctions);
            this._functions[name] = fn;
        }

        this._functionChannels = {}
    },

    checkAvailable: function() {
        return BaseDevice.Availability.AVAILABLE;
    },

    // check if a group is allowed for this compute module
    // according to some auth directive (or the default auth directive)
    verifyGroupAuthorization: function(feed) {
        for (var auth in this._module.auth) {
            var groupId = this.app.state[auth];
            if (!this.engine.devices.hasDevice(groupId)) {
                console.log('Missing authentication device');
                continue;
            }
            var group = this.engine.devices.getDevice(groupId);
            if (!group.hasKind('messaging-group'))
                continue;
            if (group.feedId === feed.feedId) {
                console.log('Found valid authorization source');
                return true;
            }
        }

        console.log('No valid authorization source, rejecting...');
        return false;
    },

    getChannel: function(id, filters) {
        if (id in this._module.functions) {
            var ch;
            if (this._functionChannels[id])
                ch = this._functionChannels[id];
            else
                ch = new ComputeModuleFunctionChannel(this._functions[id]);

            return ch.open().then(function() {
                return ch;
            });
        } else if (id in this._module.events) {
            return this.engine.channels.getNamedPipe(this.uniqueId + '-' + id, 'r');
        } else {
            throw new TypeError('Invalid channel name ' + id);
        }
    },

    _emitEvent: function(name, data) {
        // eventPipes are the sink end of the pipe, so we sendEvent(), not emitEvent()
        // the pipe subsystem will ensure to emitEvent() on the reading end as appropriate
        // the reason we need pipe is to make sure we route messages properly, as the sender
        // and the receiver might be running in different tiers
        this._eventPipes[name].sendEvent(data);
    },

    _startEventPipes: function() {
        var eventnames = Object.keys(this._module.events);
        var channels = this.engine.channels;
        return Q.all(eventnames.map(function(name) {
            return this._eventPipes[name] = channels.getNamedPipe(this.uniqueId + '-'
                                                                  + name, 'w');
        }, this));
    },

    _stopEventPipes: function() {
        var eventnames = Object.keys(this._module.events);
        return Q.all(eventnames.map(function(name) {
            return this._eventPipes[name].close();
        }, this));
    },

    start: function() {
        return this._startEventPipes().then(function() {
            return this.engine.devices.addDevice(this);
        }.bind(this));
    },

    stop: function() {
        return Q(this.engine.devices.removeDevice(this)).then(function() {
            return this._stopEventPipes();
        }.bind(this));
    }
});
