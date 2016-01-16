// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'LoggingChannel',
    Extends: Tp.SimpleAction,

    _doInvoke: function(message) {
        console.log("LoggingChannel: ", message);
    }
});

