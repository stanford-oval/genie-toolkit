// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Tp = require('thingpedia');

module.exports = new lang.Class({
    Name: 'InMessageChannel',
    Extends: Tp.BaseChannel,

    _init: function(engine, device, params) {
        this.parent();
        this.engine = engine;
        this.device = device;

        if (params.length < 1 ||
            !params[0].isFeed)
            throw new Error('Invalid @omlet.newmessage() parameters');

        this._feed = params[0].value;
        this.filterString = 'feed-' + this._feed.feedId.replace(/[^a-zA-Z0-9]+/g, '-');

        this._listener = this._onMsg.bind(this);
    },

    _onMsg: function(msg) {
        if (msg.hidden)
            return;
        console.log('Received message', msg);

        if (msg.type === 'picture') {
            var blob = this.device.omletClient.blob;

            setTimeout(function() {
                blob.getDownloadLinkForHash(msg.fullSizeHash, function(error, url) {
                    if (error) {
                        console.log('failed to get download link for picture', error);
                        return;
                    }

                    this.emitEvent([this._feed, 'picture', url]);
                }.bind(this));
            }.bind(this), 5000);
        } else if (msg.type === 'text') {
            this.emitEvent([this._feed, 'text', msg.text]);
        }
    },

    _doOpen: function() {
        return this._feed.open().then(function() {
            this._feed.on(this.signal, this._listener);
        }.bind(this));
    },

    _doClose: function() {
        this._feed.removeListener(this.signal, this._listener);
        return this._feed.close();
    }
});
