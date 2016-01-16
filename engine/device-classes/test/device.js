// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

// A... "something", that lives off some IP and port address
// using some unknown protocol
module.exports = new Tp.DeviceClass({
    Name: 'TestDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        this.host = state.host;
        this.port = state.port;

        if (typeof state.port != 'number' || isNaN(state.port))
            throw new TypeError('Invalid port number ' + state.port);

        this.hwAddress = state.hwAddress;

        this.uniqueId = 'test-device-' + state.hwAddress.replace(/:/g,'-');

        this.name = "ThingEngine™ Test Device %s".format(this.hwAddress);
        this.description = "This is a ThingEngine Test Device running at %s, port %d. It does nothing."
            .format(this.host, this.port);
    },

    // we live on the public Internet!
    // ...or not
    // doesn't really matter
    checkAvailable: function() {
        return Tp.Availability.AVAILABLE;
    },
});
