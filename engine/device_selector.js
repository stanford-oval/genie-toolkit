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

    _init: function(engine, mode, block) {
        events.EventEmitter.call(this);

        this.engine = engine;
        this._mode = mode;
        // for now, only 'me' is accessible
        this._context = engine.devices.getContext('me');
        this._selector = block.selector;
        this._channelName = block.name;
        this._params = block.params;

        this._set = null;
        this._view = null;
    },

    getChannels: function() {
        if (!this._set) // not sure how this happens, let's be robust though
            return [];
        return this._set.values();
    },

    start: function() {
        this._view = new DeviceView(null, this._context, this._selector, this._channelName,
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
