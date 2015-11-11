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

    _init: function(engine, app, mode, block) {
        events.EventEmitter.call(this);

        this.engine = engine;
        this._app = app;
        this._mode = mode;
        this._selectors = null;
        this._context = null;
        this._pipe = null;

        this._resolveSelector(block.selectors, app.state);
        this._filters = block.filters || [];

        this._set = null;
        this._view = null;
    },

    getChannels: function() {
        if (!this._set) // not sure how this happens, let's be robust though
            return [];
        return this._set.values();
    },

    _resolveSelector: function(selector, state) {
        var devices = this.engine.devices;

        var mapped = [];
        if (selector.group !== null)
            mapped.push(AppCompiler.Selector.Id(state[selector.group]));

        if (selector.devices !== null) {
            mapped = mapped.concat(selector.devices);
        } else if (selector.computeModule !== null) {
            mapped.push(AppCompiler.Selector.Id('thingengine-compute-module-' + this._app.uniqueId + '-' + selector.computeModule.name));
        } else if (selector.table !== null) {
            mapped.push(AppCompiler.Selector.Id('thingengine-table-' + this._app.uniqueId + '-' + selector.table));
        }

        this._context = devices.getContext(selector.context);
        this._selectors = mapped;
        this._channelName = selector.channelName;
    },

    start: function() {
        this._view = new DeviceView(null, this._context, this._selectors, this._channelName,
                                    this._mode, this._filters, false);
        return this._view.start().then(function(set) {
            this._set = set;

            set.on('object-added', function(o) {
                this.emit('channel-added', o);
            }.bind(this));
            set.on('object-removed', function(o) {
                this.emit('channel-removed', o);
            }.bind(this));

            set.values().forEach(function(o) {
                this.emit('channel-added', o);
            }, this);
        }.bind(this));
    },

    stop: function() {
        return this._view.stop();
    },
});
