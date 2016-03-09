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
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

// the device that owns/implements a builtin
const BuiltinOwner = {
    'timer': 'thingengine-own-global',
    'at': 'thingengine-own-global',
    'input': 'thingengine-app',
    'return': 'thingengine-app',
    'notify': 'thingengine-app',
    'logger': 'thingengine-pipe-system-writer'
};

// The named pipe system, wrapped as a device to appease DeviceView
// very evil, look away
const PipeSystemDevice = new lang.Class({
    Name: 'PipeSystemDevice',
    Extends: Tp.BaseDevice,

    _init: function(engine, mode) {
        this.parent(engine, { kind: 'thingengine-pipe-system' });
        this.mode = mode;

        // there is only one device in the context where this is put
        // so there is no need for this to be unique
        // but it has to be correct or DeviceView will not pick it
        // (it's annoying but I don't want to touch DeviceView until
        // we clear out what's the story with delegation)
        this.uniqueId = 'thingengine-pipe-system-' + (mode === 'r' ? 'reader' : 'writer');
    },

    getTrigger: function(id, params) {
        return this.engine.channels.getNamedPipe('thingengine-system-' + id, 'r');
    },

    getAction: function(id, params) {
        return this.engine.channels.getNamedPipe('thingengine-system-' + id, 'w');
    },
});
PipeSystemDevice.metadata = { types: [] };

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

    // we really only need to implement getTrigger/getAction,
    // for anything else BaseDevice is fine

    getTrigger: function(id, params) {
        return this.app.getTrigger(id, params);
    },

    getAction: function(id, params) {
        return this.app.getAction(id, params);
    }
})
AppDevice.metadata = { types: [] };

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

            // all builtins are special, but some are more special than others [semicit]
            if (owner === 'thingengine-app') {
                // builtins "owned" by thingengine-app in particular are really owned by
                // the app that is constructing this device selector
                // we handle that with a little of glue code that lets DeviceView ignore
                // the difference
                this._context = new ObjectSet.Simple();
                this._context.addOne(new AppDevice(this.engine, this.app));
            } else if (owner === 'thingengine-pipe-system-reader' ||
                       owner === 'thingengine-pipe-system-writer') {
                // builtins "owned" by thingengine-pipe-system-reader are just, well, pipes
                // but we need to massage them into something DeviceView understands
                this._context = new ObjectSet.Simple();
                this._context.addOne(new PipeSystemDevice(this.engine,
                                                          owner === 'thingengine-pipe-system-reader' ?
                                                          'r' : 'w'));
            } else {
                this._context = this.engine.devices.getContext('me');
            }

            this._selector = Ast.Selector.Id(owner);
            this._channelName = block.selector.name;
        } else if (block.selector.isComputeModule) {
            // compute modules are handled in a similar fashion as doubly special builtins
            // above
            this._context = new ObjectSet.Simple();
            this._context.addOne(this.app.getComputeModule(block.selector.module));
            // there is nothing but the right module in this context,
            // so any is fine
            this._selector = Ast.Selector.Any;
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
                    return Ast.Value.Boolean(value);
                else if (type.isString)
                    return Ast.Value.String(value);
                else if (type.isNumber)
                    return Ast.Value.Number(value);
                else if (type.isLocation)
                    return Ast.Value.Location(value.x, value.y);
                else if (type.isDate) {
                    var date = new Date();
                    date.setTime(value);
                    return Ast.Value.Date(date);
                } else if (type.isFeed) {
                    value = this.app.state['$' + p.name];
                    return Ast.Value.Feed(this.engine.messaging.getFeed(value));
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
