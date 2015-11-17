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

const MsgGroupSourceChannel = new lang.Class({
    Name: 'MsgGroupSourceChannel',
    Extends: BaseChannel,

    _init: function(engine, device) {
        this.parent(engine, device);

        this.engine = engine;
        this.device = device;

        this._listener = this._onMsg.bind(this);
    },

    _onMsg: function(msg) {
        if (msg.type != 'picture')
            return;

        console.log('msg', msg);

        var blob = this.engine.messaging._messagingIface._syncclient.blob;

        setTimeout(function() {
            blob.getDownloadLinkForHash(msg.fullSizeHash, function(error, url) {
                if (error) {
                    console.log('failed to get download link for picture', error);
                    return;
                }

                this.emitEvent({ type: 'picture', url: url });
            }.bind(this));
        }.bind(this), 5000);
    },

    _doOpen: function() {
        this._feed = this.engine.messaging.getFeed(this.device.feedId);
        return this._feed.open().then(function() {
            this._feed.on('new-message', this._listener);
        }.bind(this));
    },

    _doClose: function() {
        this._feed.removeListener('new-message', this._listener);
        return this._feed.close();
    }
});

function createChannel(engine, device) {
    return new MsgGroupSourceChannel(engine, device);
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
