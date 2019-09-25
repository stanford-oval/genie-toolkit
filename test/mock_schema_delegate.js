// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// See COPYING for details
"use strict";

const path = require('path');
const Tp = require('thingpedia');

module.exports = new Tp.FileClient({
    locale: 'en',
    thingpedia: path.resolve(path.dirname(module.filename), './thingpedia.tt'),
    entities: path.resolve(path.dirname(module.filename), './entities.json'),
    dataset: path.resolve(path.dirname(module.filename), './dataset.tt')
});
