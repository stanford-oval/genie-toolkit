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

const ObjectSet = require('./object_set');
const DeviceView = require('./device_view');
const AppCompiler = require('./app_compiler');

module.exports = new lang.Class({
    Name: 'DeviceSelector',
    Extends: events.EventEmitter,

    _init: function(engine, mode, block, compiler, state) {
        events.EventEmitter.call(this);

        this.engine = engine;
        this._mode = mode;
        this._selectors = null;
        this._context = null;
        this._pipe = null;
        this._resolveSelector(block.selectors, compiler.settings, state);
        this._filters = block.filters || [];

        this._set = null;
        this._view = null;
    },

    getChannels: function() {
        return this._set.values();
    },

    _resolveSelector: function(selectors, settings, state) {
        var context = undefined;
        var mapped = [];
        var pipe = undefined;
        var devices = this.engine.devices;
        selectors.forEach(function(simpleSelectors, idx) {
            // should be enforced by the grammar
            if (simpleSelectors.length === 0)
                throw new Error('Invalid empty simple selector');

            if (simpleSelectors.length === 1) {
                if (simpleSelectors[0].isAtPipe) {
                    if (idx === 0) {
                        // @pipe .something is a special-special-special case
                        pipe = simpleSelectors[0].name;
                        return;
                    } else {
                        throw new Error('Invalid @pipe in the middle of a traversal specification');
                    }
                } else if (simpleSelectors[0].isAtContext) {
                    if (idx === 0) {
                        context = devices.getContext(simpleSelectors[0].name);
                        return;
                    } else {
                        throw new Error('Invalid @' + simpleSelectors[0].name + ' in the middle of a traversal specification');
                    }
                } else if (simpleSelectors[0].isAtSetting) {
                    var setting = settings[simpleSelectors[0].name];
                    if (settings === undefined || !setting.type.isObject)
                        throw new Error('Invalid setting reference (@' + simpleSelectors[0].name + ' undeclared)');
                    mapped.push([AppCompiler.Selector.Id(state[simpleSelectors[0].name])]);
                }
            }

            simpleSelectors.forEach(function(simpleSelector) {
                if (!simpleSelector.isTag && !simpleSelector.isId)
                    throw new Error('Invalid @-reference: cannot use more than one');
            });

            mapped.push(simpleSelectors);
        });

        if (pipe !== undefined)
            this._pipe = pipe;
        else if (context !== undefined)
            this._context = context;
        else
            this._context = this.engine.devices.getContext('me');
        this._selectors = mapped;
    },

    start: function() {
        if (this._pipe !== null) {
            this._set = new ObjectSet.Simple();
            return this._set.add(this.engine.channels.getNamedPipe(this._pipe, this._mode));
        } else {
            this._view = new DeviceView(null, this._context, this._selectors, this._mode, this._filters, false);
            return this._view.start().then(function(set) {
                this._set = set;

                set.on('object-added', function(o) {
                    console.log('channel-added ' + o.uniqueId);
                    this.emit('channel-added', o);
                }.bind(this));
                set.on('object-removed', function(o) {
                    this.emit('channel-removed', o);
                }.bind(this));

                set.values().forEach(function(o) {
                    console.log('channel-added ' + o.uniqueId);
                    this.emit('channel-added', o);
                }, this);
            }.bind(this));
        }
    },

    stop: function() {
        if (this._pipe !== null) {
            return this._set.promise().then(function() {
                var removed = this._set.removeAll();
                return removed[0].close();
            }.bind(this));
        } else {
            return this._view.stop();
        }
    },
});
