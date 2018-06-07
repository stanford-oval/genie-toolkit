// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const V1 = require('./v1');
const V2 = require('./v2');

const GenericRestModule = require('./generic');
const RSSModule = require('./rss_factory');

module.exports = {
    'org.thingpedia.v1': V1,
    'org.thingpedia.v2': V2,
    'org.thingpedia.rss': RSSModule,
    'org.thingpedia.generic_rest.v1': GenericRestModule
};
