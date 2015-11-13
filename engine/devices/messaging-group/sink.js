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

var cnt = 0;

const MsgGroupSinkChannel = new lang.Class({
    Name: 'MsgGroupSinkChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent();

        this.engine = engine;
        this.device = device;
    },

    _doOpen: function() {
        this._feed = this.engine.messaging.getFeed(this.device.feedId);
        return this._feed.open();
    },

    _doClose: function() {
        return this._feed.close();
    },

    sendEvent: function(event) {
        console.log('Messaging Group Send Event', event);
        this._feed.sendRaw({ type: 'app', noun: 'result',
                             displayTitle: event.title,
                             displayText: event.text,
                             callback: 'http://127.0.0.1:3000/demos/callback/' + event.callback + '/' + new Buffer(JSON.stringify(event.data)).toString('base64'),
                             webCallback: 'https://thingengine.stanford.edu/omlet/web' });
    }

});

function createChannel(engine, device) {
    return new MsgGroupSinkChannel(engine, device);
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
