// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import { BasicSentenceGenerator, DialogueGenerator } from './sentence-generator/batch';
import SentenceSampler from './dataset-tools/mturk/sampler';
import { ParaphraseValidator, ParaphraseValidatorFilter } from './dataset-tools/mturk/validator';
import ValidationHITCreator from './dataset-tools/mturk/paraphrase-validation';

import DatasetAugmenter from './dataset-tools/augmentation';
import {
    DatasetParser,
    DatasetStringifier,
    DialogueParser,
    DialogueSerializer
} from './dataset-tools/parsers';
import DatasetSplitter from './dataset-tools/splitter';
import {
    SentenceEvaluatorStream,
    CollectSentenceStatistics,
} from './dataset-tools/evaluation/sentence_evaluator';
import {
    DialogueEvaluatorStream,
    CollectDialogueStatistics
} from './dataset-tools/evaluation/dialogue_evaluator';

import * as Training from './training';
import * as ParserClient from './prediction/parserclient';

import * as I18n from './i18n';
import parallelize from './utils/parallelize';
import * as EntityUtils from './utils/entity-utils';
import * as IpAddressUtils from './engine/util/ip_address';

import SpeechHandler from './speech/speech_handler';
import AssistantEngine from './engine';

import type * as SentenceGeneratorRuntime from './sentence-generator/runtime';

/**
 * Classes related to MTurk paraphrasing.
 *
 * @namespace
 */
const MTurk = {
    SentenceSampler,
    ParaphraseValidator,
    ParaphraseValidatorFilter,
    ValidationHITCreator
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
    CollectDialogueStatistics
};

export {
    // sentence generation
    BasicSentenceGenerator,
    DialogueGenerator,
    SentenceGeneratorRuntime,

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
    IpAddressUtils,

    // dialogue agent
    SpeechHandler,
    AssistantEngine,
};
