// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const seedrandom = require('seedrandom');
const { DialogGenerator } = require('../../lib/sentence-generator');

module.exports = function worker(args, shard) {
    let tpClient = null;
    if (args.thingpedia)
        tpClient = new Tp.FileClient(args);
    const options = {
        rng: seedrandom.alea(args.random_seed + ':' + shard),
        idPrefix: shard + ':',

        locale: args.locale,
        flags: args.flags || {},
        templateFiles: args.template,
        targetLanguage: args.target_language,
        thingpediaClient: tpClient,
        maxDepth: args.maxdepth,
        targetPruningSize: args.target_pruning_size,
        targetSize: args.target_size,
        maxTurns: args.max_turns,
        minibatchSize: args.minibatch_size,

        debug: args.debug,
    };
    return new DialogGenerator(options);
};
