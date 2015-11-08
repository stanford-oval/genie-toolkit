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

const NotifyChannel = new lang.Class({
    Name: 'NotifyChannel',
    Extends: BaseChannel,

    _init: function() {
        this.parent();
    },

    sendEvent: function(event) {
        var capability = platform.getCapability('notify-api');

        if (capability === null) {
            console.log('Platform does not have Notification capabilities!');
            console.log('Message dropped: ' + event.message);
            return;
        }

        console.log('Sending notify message', event);

        var title, message;
        if (event.title)
            title = event.title;
        else
            title = "ThingEngine message";
        if (!event.message) {
            if (event.title) {
                message = event.title;
                title = "ThingEngine message";
            } else
                return;
        } else {
            message = event.message;
        }

        capability.showMessage(title, message);
    }
});

function createChannel() {
    return new NotifyChannel();
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = ['notify-api'];
