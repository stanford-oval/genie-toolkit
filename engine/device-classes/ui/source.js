// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseChannel = require('../../base_channel');

const UIChannel = new lang.Class({
    Name: 'UIChannel',
    Extends: BaseChannel,

    _init: function(engine) {
        this.parent();

        this._ui = engine.ui;
        this._uiEventListener = null;
    },

    _onUIEvent: function(event) {
        this.emitEvent(event);
    },

    _doOpen: function() {
        this._uiEventListener = this._onUIEvent.bind(this);
        this._ui.on('event', this._onUIEvent);

        return Q();
    },

    _doClose: function() {
        this._ui.removeListener('event', this._uiEventListener);
        this._uiEventListener = null;

        return Q();
    }
});

function createChannel(engine) {
    return new UIChannel(engine);
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
