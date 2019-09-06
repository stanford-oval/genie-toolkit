// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const { BasicSentenceGenerator, ContextualSentenceGenerator } = require('./sentence-generator');
const SentenceSampler = require('./sampler');
const { ParaphraseValidator, ParaphraseValidatorFilter } = require('./validator');

const DatasetAugmenter = require('./dataset_augmenter');
const { DatasetParser, DatasetStringifier } = require('./dataset-parsers');
const DatasetSplitter = require('./dataset_splitter');
const { LocalTokenizer, RemoteTokenizer } = require('./tokenizer');
const Predictor = require('./predictor');

const BinaryPPDB = require('./binary_ppdb');

const Training = require('./training');

const Utils = require('./utils');

module.exports = {
    BasicSentenceGenerator,
    ContextualSentenceGenerator,
    SentenceSampler,
    ParaphraseValidator,
    ParaphraseValidatorFilter,

    BinaryPPDB,

    DatasetAugmenter,
    DatasetParser,
    DatasetStringifier,
    DatasetSplitter,

    Training,

    LocalTokenizer,
    RemoteTokenizer,
    Predictor,

    // semi-unstable API
    Utils,
};
