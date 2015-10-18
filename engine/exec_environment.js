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

module.exports = new lang.Class({
    Name: 'ExecEnvironment',

    _init: function(devicedb, appstate) {
        this._devices = devicedb;
        this._state = appstate;

        this._aliases = {};
        this._this = null;
        this._output = null;
    },

    getAllAliases: function() {
        return this._aliases;
    },

    setAlias: function(alias, value) {
        this._aliases[alias] = value;
    },

    setThis: function(obj) {
        this._this = obj;
    },

    readVar: function(name) {
        if (this._this !== null && this._this[name] !== undefined)
            return this._this[name];
        if (this._output !== null && this._output[name] !== undefined)
            return this._output[name];
        if (this._aliases[name] !== undefined)
            return this._aliases[name];
        throw new TypeError("Unknown variable " + name);
    },

    readSetting: function(type, name) {
        if (this._state[name] !== undefined)
            return this._state[name];
        if (type === Type.Boolean)
            return false;
        if (type === Type.Number)
            return 0;
        if (type === Type.String)
            return '';
        if (type === Type.Location)
            return {x:0, y:0};
    },

    readObjectProp: function(object, name) {
        if (Array.isArray(object)) {
            return object.map(function(o) {
                var v = o[name];
                if (v === undefined)
                    throw new TypeError('Object ' + o + ' has no property ' + name);
                return v;
            });
        } else {
            var v = object[name];
            if (v === undefined)
                throw new TypeError('Object ' + object + ' has no property ' + name);
            return v;
        }
    },

    readObject: function(name) {
        // recognize short forms of thingengine references
        if (name === 'me')
            name = 'thingengine-own-phone';
        else if (name === 'home')
            name = 'thingengine-own-server';

        return this._devices.getDevice(name);
    },

    beginOutput: function() {
        this._output = {};
    },

    writeValue: function(name, value) {
        this._output[name] = value;
    },

    finishOutput: function() {
        var out = this._output;
        this._output = null;
        return out;
    }
});
