// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const uuid = require('node-uuid');

const Protocol = require('../protocol');
const BaseDevice = require('../base_device');
const Tier = require('../tier_manager').Tier;

const MessagingChannelProxy = new lang.Class({
    Name: 'MessagingChannelProxy',

    _init: function(thingengine) {
        this._device = thingengine;
    },

    getChannel: function(selector, mode, filters) {
        // FINISHME implement me!
        //
        // Needs to find an appropriate auth token for selector
        // in the database, then use it to construct a transient
        // RemoteGroupDevice, then get the RemoteGroupProxy from it,
        // then call getChannel() on it
        // -or-
        // If we don't have an appropriate auth token, then we should
        // send a message to this user and ask for permissions
    }
});

const ForeignThingEngineInterface = new lang.Class({
    Name: 'ForeignThingEngineInterface',

    _init: function(device) {
        this.master = device;
        this.engine = device.engine;

        this._feed = null;
        this._feedPromise = null;
    },

    getFeed: function() {
        if (this._feedPromise !== null)
            return Q(this._feedPromise);
        else
            return this._feedPromise = this.engine.messaging.getFeedWithContact(this.master.messagingId)
            .then(function(feed) {
                this._feed = feed;
                return feed;
            });
    },

    subscribe: function(authId, authSignature, selectors, mode, filters) {
        var subscription = 'sub-' + uuid.v4();
        return this.getFeed().then(function(feed) {
            this.engine.subscriptions.registerSubscription(subscription);

            feed.sendItem({ op: 'subscribe',
                            subscriptionId: subscription,
                            authId: authId,
                            authSignature: authSignature,
                            selectors: Protocol.selectors.marshal(selectors),
                            mode: mode,
                            filters: Protocol.filters.marshal(filters) });
            return subscription;
        }.bind(this));
    },

    unsubscribe: function(subscription) {
        return this.getFeed().then(function(feed) {
            feed.sendItem({ op: 'unsubscribe',
                            subscriptionId: subscription });

            this.engine.subscriptions.unregisterSubscription(subscription);
        });
    },
});

// An instance of a ThingEngine running remotely, as discovered
// by bluetooth, mdns or whatever
// (Or more likely as created on the fly from an Omlet channel)
// Could be a server, phone or cloud instance
// Could be own or belonging to another user
//
// The reason we represent own thingengines as devices in the db
// is that pairing can leverage syncdb change propagation (with
// changes picked up by config-pairing and moved to the private
// settings). We also use them to instantiate channels that are
// inherently local, such as upnp-ssdp, so that you can ask for
// device discovery around your phone or device discovery around
// your server (ie, on your home network)
const ThingEngineDevice = new lang.Class({
    Name: 'ThingEngineDevice',
    Extends: BaseDevice,

    _init: function(engine, state) {
        this.parent(engine, state);

        this.tier = state.tier;
        // own is true if this thingengine belongs to the same user
        // as the one running the code
        // (eg, a server thingengine as seen from the phone)
        // own is false if this thingengine is some other instance
        // that we discovered through some other method
        // (eg, a server thingengine for another family member,
        // as seen from a server running on the same physical machine)
        // we still want to coordinate with foreign thingengines
        // sometimes, so we have API calls and channels, but we
        // don't sync everything through them
        this.own = state.own;

        // this !! is for legacy reasons
        this.isTransient = !!state.isTransient;

        if (this.tier === Tier.CLOUD) {
            this.cloudId = state.cloudId;
        } else if (this.tier === Tier.SERVER) {
            this.host = state.host;
            this.port = state.port;

            if (typeof state.port != 'number' || isNaN(state.port))
                throw new TypeError('Invalid port number ' + state.port);
        } else if (this.tier === Tier.PHONE) {
            this.messagingId = state.messagingId;
        }

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._tierManager = engine._tiers;

        if (this.own) {
            this.uniqueId = 'thingengine-own-' + this.tier;
            this.name = "ThingEngine %s".format(this.tier);
            this.description = "This is your own ThingEngine.";
        } else if (this.tier === Tier.CLOUD) {
            this.uniqueId = 'thingengine-foreign-cloud-' + this.cloudId;
            this.name = "Foreign ThingEngine Cloud";
            this.description = "This is the ThingEngine of some other user.";
        } else if (this.tier === Tier.SERVER) {
            this.uniqueId = 'thingengine-foreign-host-' + this.host + '-' + this.port;
            this.name = "Foreign ThingEngine Server";
            this.description = "This is the ThingEngine of some other user, running at %s, on port %d."
                .format(this.host, this.port);
        } else if (this.tier === Tier.SERVER) {
            this.uniqueId = 'thingengine-foreign-phone-' + this.messagingId.replace(/[^a-z0-9]/g, '-');
            this.name = "Foreign ThingEngine Phone";
            this.description = "This is the ThingEngine of some other user, running on a phone reachable at " + this.messagingId;
        }
    },

    get ownerTier() {
        // servers talk to servers, clouds to clouds, phones to phones
        return this.tier;
    },

    checkAvailable: function() {
        if (this.own && this.tier === this._tierManager.ownTier)
            return BaseDevice.Availability.AVAILABLE;
        else if (this.own)
            return (this._tierManager.isConnected(this.tier) ?
                    BaseDevice.Availability.AVAILABLE :
                    BaseDevice.Availability.UNAVAILABLE);
        else if (this.engine.messaging.isAvailable)
            return BaseDevice.Availability.AVAILABLE;
        else
            return BaseDevice.Availability.UNAVAILABLE;
    },

    hasKind: function(kind) {
        switch (kind) {
        case 'thingengine-system':
        case 'thingengine-own':
            return this.own;
        case 'thingengine-server':
            return this.tier === Tier.SERVER;
        case 'thingengine-phone':
            return this.tier === Tier.PHONE;
        case 'thingengine-cloud':
            return this.tier === Tier.CLOUD;
        default:
            return this.parent(kind);
        }
    },

    _getContext: function() {
        if (this.tier === Tier.PHONE)
            return 'phone';
        else if (this.tier === Tier.SERVER)
            return 'home';
        else if (this.tier === Tier.CLOUD)
            return 'cloud';
        else
            throw new Error('Unexpected tier ' + this.tier);
    },

    queryInterface: function(iface) {
        switch(iface) {
        case 'device-group':
            if (this.own)
                return this.engine.devices.getContext(this._getContext());
            else
                return null;

        case 'device-channel-proxy':
            if (this.own)
                return null;
            else
                return new MessagingChannelProxy(this);

        case 'thingengine-foreign':
            if (this.own || this.tier !== Tier.PHONE)
                return null;
            else
                return new ForeignThingEngineInterface(this);

        default:
            return null;
        }
    },
});

function createDevice(engine, state) {
    return new ThingEngineDevice(engine, state);
}

module.exports.createDevice = createDevice;
