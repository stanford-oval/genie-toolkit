// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'OmletSendChannel',

    sendEvent: function(event) {
        if (event.length < 3)
            throw new TypeError('Invalid arguments to @omlet.send(), expected feed, type, message');

        var feed = event[0];
        var msgType = event[1];
        var msg = event[2];

        if (msgType === 'text')
            feed.sendText(msg).done();
        else if (msgType === 'picture')
            feed.sendPicture(msg).done();
        else
            throw new TypeError('Invalid message type, expected text or picture');
    },
});
