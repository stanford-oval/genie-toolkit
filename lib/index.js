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

const { SentenceGenerator, BasicSentenceGenerator, DialogueGenerator } = require('./sentence-generator');
const SentenceSampler = require('./dataset-tools/mturk/sampler');
const { ParaphraseValidator, ParaphraseValidatorFilter } = require('./dataset-tools/mturk/validator');
const ValidationHITCreator = require('./dataset-tools/mturk/paraphrase-validation');

const DatasetAugmenter = require('./dataset-tools/augmentation');
const { DatasetParser, DatasetStringifier } = require('./dataset-tools/parsers');
const DatasetSplitter = require('./dataset-tools/splitter');
const { LocalTokenizer, RemoteTokenizer } = require('./tokenizer');
const Predictor = require('./prediction/predictor');
const {
    SentenceEvaluatorStream,
    CollectSentenceStatistics,
} = require('./dataset-tools/evaluation/sentence_evaluator');
const {
    DialogueEvaluatorStream,
    CollectDialogueStatistics
} = require('./dataset-tools/evaluation/dialogue_evaluator');

const Training = require('./training');

const Utils = require('./utils/misc-utils');
const I18n = require('./i18n');
const parallelize = require('./utils/parallelize');

const SpeechHandler = require('./speech/speech_handler');

module.exports = {
    SentenceGenerator,
    BasicSentenceGenerator,
    DialogueGenerator,
    SentenceSampler,
    ParaphraseValidator,
    ParaphraseValidatorFilter,
    ValidationHITCreator,

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
    DialogueEvaluatorStream,
    CollectDialogueStatistics,

    // semi-unstable API
    Utils,
    I18n,
    parallelize,

    // new API (to be categorized/cleaned up)
    SpeechHandler,
};
