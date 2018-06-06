// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// preload all modules, for the benefit of browserify
exports['org.thingpedia.builtin.bluetooth.generic'] = require('./bluetooth.generic');
exports['org.thingpedia.builtin.matrix'] = require('./matrix');
exports['org.thingpedia.builtin.test'] = require('./test');
exports['org.thingpedia.builtin.thingengine'] = require('./thingengine');
exports['org.thingpedia.builtin.thingengine.builtin'] = require('./thingengine.builtin');
exports['org.thingpedia.builtin.thingengine.phone'] = require('./thingengine.phone');
exports['org.thingpedia.builtin.thingengine.remote'] = require('./thingengine.remote');
exports['org.thingpedia.builtin.thingengine.home'] = require('./thingengine.home');
exports['org.thingpedia.builtin.thingengine.gnome'] = require('./thingengine.gnome');