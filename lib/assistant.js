// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const events = require('events');
const adt = require('adt');

try {
const Sabrina = require('sabrina').Sabrina;

var Assistant = new lang.Class({
    Name: 'Assistant',
    Extends: Sabrina,
    $rpcMethods: ['handleCommand', 'setDelegate'],

    _init: function(engine) {
        this.parent(engine);

        this._notify = null;
        this._notifyListener = this.notify.bind(this);

    },

    get ui() {
        return this._engine.ui;
    },

    start: function() {
        this.parent();
        return this.ui.getAllNotify().then(function(notify) {
            this._notify = notify;
            notify.on('data', this._notifyListener);
        }.bind(this));
    },

    stop: function() {
        this.parent();

        if (this._notify) {
            this._notify.removeListener('data', this._notifyListener);
            return this._notify.close();
        } else {
            return Q();
        }
    }
});
} catch (e) {
var Assistant = null;
}

const DummyAssistant = new lang.Class({
    Name: 'DummyAssistant',

    _init: function() {
    },

    start: function() {
        return Q();
    },

    stop: function() {
        return Q();
    },

    handleCommand: function(command) {
        throw new Error('handleCommand should not be called on this platform');
    },
});

function create(engine) {
    if (platform.hasCapability('assistant'))
        return new Assistant(engine);
    else
        return new DummyAssistant();
}

module.exports.create = create;
