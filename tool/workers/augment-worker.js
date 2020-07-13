// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const ThingTalk = require('thingtalk');
const seedrandom = require('seedrandom');
const Tp = require('thingpedia');

const DatasetAugmenter = require('../../lib/dataset-tools/augmentation');
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
        cleanParameters: args.clean_parameters,
        requotable: args.requotable,
        samplingType: args.sampling_type,
        numAttempts: args.num_attempts
    });
};

