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
const Tp = require('thingpedia');

const ObjectSet = require('./object_set');
const DeviceView = require('./device_view');
const AppCompiler = require('./app_compiler');

// the device that owns/implements a builtin
const BuiltinOwner = {
    'timer': 'thingengine-own-global',
    'at': 'thingengine-own-global',
    'input': 'thingengine-app',
    'return': 'thingengine-app',
    'notify': 'thingengine-app',
    'logger': 'thingengine-own-server'
};

// A app, wrapped as a device to appease DeviceView
// very evil, look away
const AppDevice = new lang.Class({
    Name: 'AppDevice',
    Extends: Tp.BaseDevice,

    _init: function(engine, app) {
        this.parent(engine, { kind: 'thingengine-app' });
        this.app = app;

        // there is only one device in the context where this is put
        // so there is no need for this to be unique
        // it is not shared between rules or anything, sharing happens
        // at the app level
        this.uniqueId = 'thingengine-app';
    },

    // we really only need to implement getChannel,
    // for anything else BaseDevice is fine

    getChannel: function(id, params) {
        return this.app.getChannel(id, params);
    }
})

module.exports = new lang.Class({
    Name: 'DeviceSelector',
    Extends: events.EventEmitter,

    _init: function(engine, app, mode, block) {
        events.EventEmitter.call(this);

        this.engine = engine;
        this.app = app;
        this._mode = mode;
        this._normalizeSelector(block);
        if (mode === 'r')
            this._params = this._normalizeParams(block.params);
        else
            this._params = [];

        this._set = null;
        this._view = null;
    },

    _normalizeSelector: function(block) {
        // for now, only 'me' is accessible
        if (block.selector.isBuiltin) {
            var owner = BuiltinOwner[block.selector.name];

            if (owner === 'thingengine-app') {
                // all builtins are special, but some are more special than others [semicit]
                // builtins "owned" by thingengine-app in particular are really owned by
                // the app that is constructing this device selector
                // we handle that with a little of glue code that lets DeviceView ignore
                // the difference
                this._context = new ObjectSet.Simple();
                this._context.addOne(new AppDevice(this.engine, this.app));
            } else {
                this._context = this.engine.devices.getContext('me');
            }

            this._selector = AppCompiler.Selector.Id(owner);
            this._channelName = block.selector.name;
        } else if (block.selector.isComputeModule) {
            // compute modules are handled in a similar fashion as doubly special builtins
            // above
            this._context = new ObjectSet.Simple();
            this._context.addOne(this.app.getComputeModule(block.selector.module));
            // there is nothing but the right module in this context,
            // so any is fine
            this._selector = AppCompiler.Selector.Any;
            this._channelName = block.name;
        } else {
            this._context = this.engine.devices.getContext('me');
            this._selector = block.selector;
            this._channelName = block.name;
        }
    },

    _normalizeParams: function(params) {
        return params.map(function(p) {
            if (p.isConstant) {
                return p.value;
            } else if (p.isVarRef) {
                var type = this.app.compiler.params[p.name];
                var value = this.app.state[p.name];
                if (type.isBoolean)
                    return AppCompiler.Value.Boolean(value);
                else if (type.isString)
                    return AppCompiler.Value.String(value);
                else if (type.isNumber)
                    return AppCompiler.Value.Number(value);
                else if (type.isLocation)
                    return AppCompiler.Value.Location(value.x, value.y);
                else if (type.isDate) {
                    var date = new Date();
                    date.setTime(value);
                    return AppCompiler.Value.Date(date);
                } else if (type.isFeed) {
                    value = this.app.state['$' + p.name];
                    return AppCompiler.Value.Feed(this.engine.messaging.getFeed(value));
                } else
                    throw new TypeError();
            } else
                throw new TypeError();
        }, this);
    },

    getChannels: function() {
        if (!this._set) // not sure how this happens, let's be robust though
            return [];
        return this._set.values();
    },

    start: function() {
        this._view = new DeviceView(null, this._context, [this._selector], this._channelName,
                                    this._params, this._mode, false);
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
