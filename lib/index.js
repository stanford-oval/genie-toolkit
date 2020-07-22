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

const { BasicSentenceGenerator, DialogueGenerator } = require('./sentence-generator/batch');
const SentenceSampler = require('./dataset-tools/mturk/sampler');
const { ParaphraseValidator, ParaphraseValidatorFilter } = require('./dataset-tools/mturk/validator');
const ValidationHITCreator = require('./dataset-tools/mturk/paraphrase-validation');

const DatasetAugmenter = require('./dataset-tools/augmentation');
const {
    DatasetParser,
    DatasetStringifier,
    DialogueParser,
    DialogueSerializer
} = require('./dataset-tools/parsers');
const DatasetSplitter = require('./dataset-tools/splitter');
const {
    SentenceEvaluatorStream,
    CollectSentenceStatistics,
} = require('./dataset-tools/evaluation/sentence_evaluator');
const {
    DialogueEvaluatorStream,
    CollectDialogueStatistics
} = require('./dataset-tools/evaluation/dialogue_evaluator');

const Training = require('./training');
const ParserClient = require('./prediction/parserclient');

const I18n = require('./i18n');
const parallelize = require('./utils/parallelize');
const EntityUtils = require('./utils/entity-utils');

const SpeechHandler = require('./speech/speech_handler');
const AssistantEngine = require('./engine');

/**
 * Classes related to MTurk paraphrasing.
 *
 * @namespace
 */
const MTurk = {
    SentenceSampler,
    ParaphraseValidator,
    ParaphraseValidatorFilter,
    ValidationHITCreator,
};

/**
 * Classes related to evaluation of a model.
 *
 * @namespace
 */
const Evaluation = {
    SentenceEvaluatorStream,
    CollectSentenceStatistics,
    DialogueEvaluatorStream,
    CollectDialogueStatistics,
};

module.exports = {
    // sentence generation
    BasicSentenceGenerator,
    DialogueGenerator,

    // dataset manipulation
    DatasetParser,
    DatasetStringifier,
    DatasetAugmenter,
    DatasetSplitter,
    DialogueParser,
    DialogueSerializer,

    I18n,
    MTurk,
    Training,
    Evaluation,
    ParserClient,

    // semi-unstable API
    parallelize,
    EntityUtils,

    // dialogue agent
    SpeechHandler,
    AssistantEngine,
};
