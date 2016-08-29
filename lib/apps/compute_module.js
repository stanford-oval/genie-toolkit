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
const vm = require('vm');
const Tp = require('thingpedia');

const ComputeModuleFunctionChannel = new Tp.ChannelClass({
    Name: 'ComputeModuleFunctionChannel',

    _init: function(ast, fn) {
        this.parent();

        this._ast = ast;
        this._fn = fn;
    },

    sendEvent: function(args) {
        return this._fn.apply(null, args);
    }
});

module.exports = class ComputeModule {
    constructor(engine, app, name, module) {
        this.engine = engine;
        this.app = app;

        // this is used for the pipes
        this.uniqueId = 'thingengine-compute-module-' + app.uniqueId + '-' + name;

        this._name = name;
        this._module = module;

        var scope = {};

        var keywords = app.compiler.keywords;
        for (var name in keywords) {
            Object.defineProperty(scope, name, { configurable: true,
                                                 enumerable: true,
                                                 get: function() {
                                                     return this._readKeyword(name);
                                                 }.bind(this) });
        }

        var events = Object.keys(module.events);
        events.forEach(function(name) {
            var event = module.events[name];
            Object.defineProperty(scope, name, { configurable: true,
                                                 enumerable: true,
                                                 writable: false,
                                                 value: function() {
                                                     return this._emitEvent(name, arguments);
                                                 }.bind(this) });
        }, this);

        Object.seal(scope);

        this._context = vm.createContext(scope);

        this._functions = {};
        this._eventPipes = {};

        for (var name in module.functions) {
            var ast = module.functions[name];
            var fn = vm.runInContext('(function(' + ast.params.join(',')
                                     +') {' + ast.code + '});', this._context);
            this._functions[name] = fn;
        }

        this._functionChannels = {}
    }

    getAction(id) {
        if (id in this._module.functions) {
            var ch;
            if (this._functionChannels[id])
                ch = this._functionChannels[id];
            else
                ch = new ComputeModuleFunctionChannel(this._module.functions[id],
                                                      this._functions[id]);
            this._functionChannels[id] = ch;

            return ch.open().then(function() {
                return ch;
            });
        } else {
            throw new TypeError('Invalid channel name ' + id);
        }
    }

    getTrigger(id) {
        if (id in this._module.events) {
            return this.engine.channels.getNamedPipe(this.uniqueId + '-' + id, 'r');
        } else {
            throw new TypeError('Invalid channel name ' + id);
        }
    }

    _getKeyword(name, decl) {
        var compiler = this.app.compiler;

        var scope, name, feedId;
        if (decl.feedAccess)
            feedId = this.app.feedId;
        else
            feedId = null;
        if (decl.extern)
            scope = null;
        else
            scope = this.app.uniqueId;
        name = name;

        return this.engine.keywords.getOpenedKeyword(scope, name, feedId);
    }

    _readKeyword(name) {
        return this._keywords[name].value;
    }

    _emitEvent(name, data) {
        // eventPipes are the sink end of the pipe, so we sendEvent(), not emitEvent()
        // the pipe subsystem will ensure to emitEvent() on the reading end as appropriate
        // the reason we need pipe is to make sure we route messages properly, as the sender
        // and the receiver might be running in different tiers
        this._eventPipes[name].then(function(ch) {
            ch.sendEvent(data);
        });
    }

    _startEventPipes() {
        var eventnames = Object.keys(this._module.events);
        var channels = this.engine.channels;
        return Q.all(eventnames.map(function(name) {
            return this._eventPipes[name] = channels.getNamedPipe(this.uniqueId + '-'
                                                                  + name, 'w');
        }, this));
    }

    _startKeywords() {
        var keywords = this.app.compiler.keywords;
        this._keywords = {};

        var promises = [];
        for (var name in keywords) {
            var p = this._getKeyword(name, keywords[name]).then(function(kw) {
                this._keywords[name] = kw;
            }.bind(this));
            promises.push(p);
        }
        return Q.all(promises);
    }

    _stopEventPipes() {
        var eventnames = Object.keys(this._module.events);
        return Q.all(eventnames.map(function(name) {
            return this._eventPipes[name].then(function(pipe) {
                return pipe.close();
            });
        }, this));
    }

    _stopKeywords() {
        var keywords = this.app.compiler.keywords;

        var promises = [];
        for (var name in keywords) {
            var p = this._keywords[name];
            promises.push(kw.close());
        }
        return Q.all(promises);
    }

    start() {
        return Q.all([this._startEventPipes(),
                      this._startKeywords()]);
    }

    stop() {
        return Q.all([this._stopEventPipes(),
                      this._startKeywords()]);
    }
}
