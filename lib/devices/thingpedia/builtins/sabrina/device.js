// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

function makeSimpleActionClass(kind) {
    return new Tp.ChannelClass({
        Name: 'SimpleAction' + kind,

        _init: function(engine, device) {
            this.parent();
            this.device = device;
        },

        sendEvent: function(event) {
            this.device.invokeAction(kind, event);
        }
    });
}

module.exports = new Tp.DeviceClass({
    Name: 'SabrinaDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        if (!state.own)
            throw new TypeError('Remote Sabrinas are not yet supported');

        this.uniqueId = 'thingengine-own-sabrina';
    },

    _doSay: function(message) {
        this.engine.assistant.sendReply(message)
        .catch(function(e) {
            console.error('Failed to send message from Sabrina');
            console.error(e.stack);
        });
    },

    _doPicture: function(url) {
        this.engine.assistant.sendPicture(url)
        .catch(function(e) {
            console.error('Failed to send picture from Sabrina');
            console.error(e.stack);
        });
    },

    invokeAction: function(name, args) {
        switch (name) {
        case 'say':
            return this._doSay(args[0]);
        case 'picture':
            return this._doPicture(args[0]);
        }
    },

    getActionClass: function(name) {
        switch (name) {
        case 'say':
        case 'picture':
            return makeSimpleActionClass(name);
        default:
            throw new Error('Invalid action ' + name);
        }
    }
});
