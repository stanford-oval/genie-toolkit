// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Messaging = require('./lib/messaging');
const BaseDevice = require('./lib/base_device');
const BaseChannel = require('./lib/base_channel');
const UtilityDev = require('./lib/utility_devices');
const UtilityCh = require('./lib/utility_channels');

// a meta class for inheriting from BaseDevice, which avoids exposing
// lang.Class, and also has some utility for adding devices
const DeviceClass = new lang.Class({
    Name: 'DeviceClass',
    Extends: lang.Class,

    _construct: function(params) {
        if (!params.Extends)
            params.Extends = BaseDevice;
        return lang.Class.prototype._construct.call(this, params);
    },

    _init: function(params) {
        var useOAuth2 = params.UseOAuth2;
        var useDiscovery = params.UseDiscovery;
        delete params.UseOAuth2;
        delete params.UseDiscovery;

        if (useDiscovery)
            this.addFromDiscovery = useDiscovery;
        if (useOAuth2)
            this.runOAuth2 = useOAuth2;

        var kinds = params.Kinds;
        delete params.Kinds;
        if (kinds && !params.hasKind) {
            params.hasKind = function(kind) {
                if (kinds.indexOf(kind) >= 0)
                    return true;
                return this.parent(kind);
            }
        }

        this.parent(params);
    },
});

// same for BaseChannel, which also hides refcounted
const ChannelClass = new lang.Class({
    Name: 'ChannelClass',
    Extends: lang.Class,

    _construct: function(params) {
        if (!params.Extends)
            params.Extends = BaseChannel;
        return this.parent(params);
    },

    _init: function(params) {
        var requiredCapabilities = params.RequiredCapabilities;
        if (requiredCapabilities) {
            delete params.RequiredCapabilities;
            this.requiredCapabilities = requiredCapabilities;
        } else {
            this.requiredCapabilities = [];
        }

        this.parent(params);
    },
});

module.exports = {
    BaseDevice: BaseDevice,
    OnlineAccount: UtilityDev.OnlineAccount,

    BaseChannel: BaseChannel,
    PollingTrigger: UtilityCh.PollingTrigger,
    HttpPollingTrigger: UtilityCh.HttpPollingTrigger,
    SimpleAction: UtilityCh.SimpleAction,

    DeviceClass: DeviceClass,
    ChannelClass: ChannelClass,

    Availability: BaseDevice.Availability,
    Tier: BaseDevice.Tier,

    Messaging: Messaging,
};
