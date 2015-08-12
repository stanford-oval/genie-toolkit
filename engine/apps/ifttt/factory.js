// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseApp = require('../base_app');

const trigger = require('./trigger');
const action = require('./action');

const IftttApp = new lang.Class({
    Name: 'IftttApp',
    Extends: BaseApp,

    _init: function(trigger, actions) {
        this.parent();

        this._trigger = trigger;
        this._actions = actions;
        this._sources = [];
    },

    serialize: function() {
        // FINISHME
        throw new Error('NYI');
    },

    _onEvent: function() {
        var context = {}
        if (this._trigger.isFiring(context))
            this._actions.forEach(function(a) { a.execute(context); });
    },

    start: function() {
        // collect all event sources and start listening on each of them
        return this._trigger.getEventSources().then(function(sources) {
            this._sources = sources;
            sources.forEach(function(s) {
                s.on('event', this._onEvent.bind(this));
            }.bind(this));
            return Q.all(sources.map(function(s) {
                return s.enable();
            }));
        }.bind(this));
    },

    stop: function() {
        Q.all(this._sources.map(function(s) {
            return s.disable();
        })).finally(function() {
            this._sources = [];
        }.bind(this));
    }
});

var channelPool = {};
function getChannel(uri) {
    if (uri in channelPool)
        return channelPool[uri];
    else
        return channelPool[uri] = { uri: uri };
}

function createApp(engine, serializedApp) {
    return new IftttApp(trigger.createTrigger(engine, getChannel, serializedApp.trigger),
                        serializedApp.actions.map(function(a) { return action.createAction(engine, getChannel, a); }));
}
