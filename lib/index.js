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

const { SentenceGenerator, BasicSentenceGenerator, ContextualSentenceGenerator, DialogueGenerator } = require('./sentence-generator');
const SentenceSampler = require('./sampler');
const { ParaphraseValidator, ParaphraseValidatorFilter } = require('./validator');
const ValidationHITCreator = require('./validation');
const Contextualizer = require('./contextualizer');
const ContextExtractor = require('./context-extractor');

const DatasetAugmenter = require('./dataset_augmenter');
const { DatasetParser, DatasetStringifier } = require('./dataset-parsers');
const DatasetSplitter = require('./dataset_splitter');
const { LocalTokenizer, RemoteTokenizer } = require('./tokenizer');
const Predictor = require('./predictor');
const {
    SentenceEvaluatorStream,
    CollectSentenceStatistics,

    DialogEvaluatorStream,
    CollectDialogStatistics
} = require('./evaluators');

const Training = require('./training');

const Utils = require('./utils');
const I18n = require('./i18n');
const parallelize = require('./parallelize');

module.exports = {
    SentenceGenerator,
    BasicSentenceGenerator,
    ContextualSentenceGenerator,
    DialogueGenerator,
    SentenceSampler,
    ParaphraseValidator,
    ParaphraseValidatorFilter,
    ValidationHITCreator,
    ContextExtractor,
    Contextualizer,

    DatasetAugmenter,
    DatasetParser,
    DatasetStringifier,
    DatasetSplitter,

    Training,

    LocalTokenizer,
    RemoteTokenizer,
    Predictor,

    SentenceEvaluatorStream,
    CollectSentenceStatistics,
    DialogEvaluatorStream,
    CollectDialogStatistics,

    // semi-unstable API
    Utils,
    I18n,
    parallelize
};
