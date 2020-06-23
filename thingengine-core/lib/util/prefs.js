// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

// for compatibility with the many modules that do require(thingengine-core/lib/prefs)
// we temporarily re-export things here

module.exports = {
    Preferences: Tp.Preferences,
    FilePreferences: Tp.Helpers.FilePreferences
};
