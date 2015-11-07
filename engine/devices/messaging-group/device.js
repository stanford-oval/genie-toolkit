// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseDevice = require('../../base_device');
const ObjectSet = require('../../object_set');

const SharedGroupDeviceView = new lang.Class({
    Name: 'SharedGroupDeviceView',
    Extends: ObjectSet.Simple,

    _init: function(engine, feed) {
        this.parent(false);

        this._feed = feed;
        this._messaging = engine.messaging;
        this._factory = engine.devices.factory;

        console.log('Created SharedGroupDeviceView for feed ' + feed.feedId);
    },

    _onNewMessage: function(msg) {
        if (msg.type !== 'rdl')
            return;

        if (!msg.callback || !msg.callback.startsWith('https://thingengine.stanford.edu'))
            return;

        try {
            var parsed = JSON.parse(msg.json);

            this._messaging.getAccountById(msg.senderId).then(function(account) {
                return this.addOne(this._factory.createDevice('remote-group',
                                                              { isTransient: true,
                                                                ownerId: account,
                                                                authId: parsed.groupId,
                                                                authSignature: parsed.groupToken,
                                                                name: msg.displayTitle }));
            }.bind(this)).done();
        } catch(e) {
            if (e.name === 'SyntaxError')
                console.log('Failed to parse incoming Omlet RDL: ' + e);
            else
                throw e;
        }
    },

    close: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        return this._feed.close();
    },

    open: function() {
        this._msgListener = this._onNewMessage.bind(this);
        this._feed.on('incoming-message', this._msgListener);

        return this._feed.open().then(function() {
            var cursor = this._feed.getCursor();

            try {
                while (cursor.hasNext()) {
                    var obj = cursor.next();
                    if (this._feed.ownIds.indexOf(obj.senderId) >= 0)
                        continue;

                    this._onNewMessage(obj);
                }
            } finally {
                cursor.destroy();
            }
        }.bind(this));
    },
});

const SharedGroupMemberView = new lang.Class({
    Name: 'SharedGroupMemberView',
    Extends: ObjectSet.Simple,

    _init: function(engine, feed) {
        this.parent(false);

        this._feed = feed;
        this._messaging = engine.messaging;
        this._factory = engine.devices.factory;
    },

    close: function() {
        this._feed.removeListener('incoming-message', this._msgListener);
        return this._feed.close();
    },

    open: function() {
        this._msgListener = this._onNewMessage.bind(this);
        this._feed.on('incoming-message', this._msgListener);

        return this._feed.open().then(function() {
            return this._feed.getMembers();
        }).then(function(members) {
            return Q.all(members.map(function(member) {
                return this._messaging.getAccountById(member).then(function(account) {
                    return this.addOne(this._factory.createDevice('thingengine',
                                                                  { isTransient: true,
                                                                    tier: 'phone',
                                                                    messagingId: account,
                                                                    own: false }));
                }, this);
            }.bind(this)));
        }.bind(this));
    },
});

const SharedDeviceGroup = new lang.Class({
    Name: 'SharedDeviceGroup',

    _init: function(device) {
        this.device = device;
        this.engine = device.engine;

        this._messaging = device.engine.messaging;
        this._feed = this._messaging.getFeed(device.feedId);
    },

    getSharedDevices: function() {
        return new SharedGroupDeviceView(this.engine, this._feed);
    },

    getMemberEngines: function() {
        return new SharedGroupMemberView(this.engine, this._feed);
    },
});

const MessagingGroupChannelProxy = new lang.Class({
    Name: 'MessagingGroupChannelProxy',

    _init: function(master) {
        this.master = master;
        console.log('Created MessagingGroupChannelProxy for ' + master.uniqueId);
    },

    getChannel: function(selectors, channelName, mode, filters) {
        var master = this.master;
        var channels = master.engine.channels;

        if (!selectors[0].isId)
            return null;

        return channels.getOpenedChannel(master, 'proxy', selectors[0].name,
                                         selectors.slice(1), channelName, mode, filters);
    }
});

const MessagingGroupDevice = new lang.Class({
    Name: 'TestDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        // this device is never stored on disk
        this.isTransient = true;

        this.uniqueId = 'messaging-group-' + this.messagingDeviceKind +
            this.feedId.replace(/[^a-zA-Z0-9]+/g, '-');

        this._syncName();
        this._feed = null;
    },

    _syncName: function() {
        this.name = "Messaging Group %s".format(this.state.name);
        this.description = "This is a messaging group. All devices shared in this " +
            "group become available to all members of the group. " +
            "You can use the identifier ." + this.uniqueId + " to refer to this group.";
    },

    updateState: function(state) {
        this.parent(state);
        this._syncName();
    },

    get messagingDeviceKind() {
        return this.state.messagingDeviceKind;
    },

    get feedId() {
        return this.state.feedId;
    },

    get feed() {
        if (this._feed === null)
            this._feed = this.engine.messaging.getFeed(this.feedId);
        return this._feed;
    },

    hasKind: function(kind) {
        switch(kind) {
        case 'shared-device-group':
            return true;
        default:
            return this.parent(kind);
        }
    },

    queryInterface: function(iface) {
        switch(iface) {
        case 'shared-device-group':
            return new SharedDeviceGroup(this);
        case 'device-channel-proxy':
            return new MessagingGroupChannelProxy(this);
        case 'messaging-feed':
            return this.feed;
        default:
            return null;
        }
    },

    checkAvailable: function() {
        if (this.engine.messaging.isAvailable)
            return BaseDevice.Availability.AVAILABLE;
        else
            return BaseDevice.Availability.UNAVAILABLE;
    },
});

function createDevice(engine, state) {
    return new MessagingGroupDevice(engine, state);
}

module.exports.createDevice = createDevice;
