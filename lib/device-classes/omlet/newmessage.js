// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');
const InMessageChannel = require('./inmessage');

module.exports = new Tp.ChannelClass({
    Name: 'NewMessageChannel',
    Extends: InMessageChannel,
    signal: 'new-message',
});
