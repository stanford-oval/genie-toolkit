// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const fs = require('fs');

const Engine = require('./engine');

function runEngine() {
  global.platform = require('./platform');

  var engine = new Engine();
  engine.start().then(function() {
    return engine.run().finally(function() {
       return engine.stop();
      })
    }).done();
}

JXMobile('runEngine').registerToNative(runEngine);


