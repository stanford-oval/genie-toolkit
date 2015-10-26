// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const Messaging = require('./engine/messaging');
const Feed = Messaging.Feed;
const FeedCursor = Messaging.FeedCursor;

const JavaAPI = require('./java_api');

const OmletAPI = JavaAPI.makeJavaAPI('OmletAPI',
                                     ['createControlFeed',
                                      'openFeed',
                                      'closeFeed',
                                      'getFeedCursor',
                                      'destroyCursor',
                                      'getCursorValue',
                                      'hasNextCursor',
                                      'nextCursor',
                                      'getMembers',
                                      'startWatchFeed',
                                      'stopWatchFeed',
                                      'sendItemOnFeed']);

const OmletFeed = new lang.Class({
    Name: 'OmletFeed',
    Extends: Feed,

    _init: function(feedId) {
        this.parent(feedId);
    }
});

module.exports = new lang.Class({
    Name: 'OmletMessaging',

    createFeed: function() {
        return OmletAPI.createControlFeed().then(function(uri) {
            if (!uri.startsWith('content://mobisocial.osm/feeds/'))
                throw new Error('Invalid Omlet Feed URI ' + uri);

            return new OmletFeed(uri.substr('content://mobisocial.osm/feeds/'.length));
        });
    },

    getFeed: function(feedId) {
        return new OmletFeed(feedId);
    }
});
