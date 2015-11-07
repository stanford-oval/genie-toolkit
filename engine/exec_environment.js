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

        this._enabledFlags = {};

        this.reset();
    },

    setInputBlockEnabled: function(name, enabled) {
        this._enabledFlags[name] = enabled;
    },

    getInputBlockEnabled: function(name) {
        if (this._enabledFlags[name] === undefined)
            return true;
        else
            return !!this._enabledFlags[name];
    },

    reset: function() {
        this._scope = {};
        this._previousThis = null;
        this._this = null;
        this._useCurrent = true;
        this._output = null;
    },

    // deprecated
    getAllAliases: function() {
        return this._scope;
    },

    mergeScope: function(scope) {
        for (var name in scope)
            this._scope[name] = scope[name];
    },

    setPreviousThis: function(obj) {
        this._previousThis = obj;
    },

    setThis: function(obj) {
        this._this = obj;
    },

    get hasPrevious() {
        return this._previousThis !== null;
    },

    setUseCurrent: function(flag) {
        this._useCurrent = flag;
    },

    readVar: function(type, name) {
        var thisobj = this._useCurrent ? this._this : this._previousThis;
        if (thisobj !== null && thisobj[name] !== undefined)
            return thisobj[name];
        if (this._output !== null && this._output[name] !== undefined)
            return this._output[name];
        if (this._scope[name] !== undefined)
            return this._scope[name];
        if (this._state[name] !== undefined)
            return this._state[name];
        if (type.isBoolean)
            return false;
        if (type.isNumber || type.isMeasure)
            return 0;
        if (type.isString)
            return '';
        if (type.isLocation)
            return {x:0, y:0};
        throw new TypeError("Unknown variable " + name);
    },

    readObjectProp: function(object, name) {
        var v = object[name];
        if (v === undefined)
            throw new TypeError('Object ' + object + ' has no property ' + name);
        return v;
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
