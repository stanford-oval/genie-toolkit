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

const ThingTalk = require('thingtalk');
const seedrandom = require('seedrandom');
const Tp = require('thingpedia');

const DatasetAugmenter = require('../../lib/dataset_augmenter');
const FileParameterProvider = require('../lib/file_parameter_provider');

module.exports = async function worker(args, shard) {
    const tpClient = new Tp.FileClient(args);
    const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, args.debug);
    const constProvider = new FileParameterProvider(args.parameter_datasets, args.param_locale);
    await constProvider.open();

    return new DatasetAugmenter(schemaRetriever, constProvider, tpClient, {
        rng: seedrandom.alea(args.random_seed + ':' + shard),
        locale: args.locale,
        paramLocale: args.param_locale,
        targetLanguage: args.target_language,
        debug: args.debug,

        quotedProbability: args.quoted_fraction,
        untypedStringProbability: args.untyped_string_probability,
        maxSpanLength: args.max_span_length,
        syntheticExpandFactor: args.synthetic_expand_factor,
        paraphrasingExpandFactor: args.quoted_paraphrasing_expand_factor,
        noQuoteExpandFactor: args.no_quote_paraphrasing_expand_factor,
        singleDeviceExpandFactor: args.single_device_expand_factor,
        replaceLocations: args.replace_locations,
        replaceNumbers: args.replace_numbers,
        cleanParameters: args.clean_parameters
    });
};

