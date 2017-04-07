// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Almond = require('./lib/sabrina');

module.exports = Almond;
// for compat with require('sabrina').Almond
Almond.Almond = Almond;
