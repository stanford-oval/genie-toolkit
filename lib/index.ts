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

import DatasetAugmenter from './dataset-tools/augmentation';
import {
    DatasetParser,
    DatasetStringifier,
    DialogueParser,
    DialogueSerializer
} from './dataset-tools/parsers';
import DatasetSplitter from './dataset-tools/splitter';

import * as MTurk from './dataset-tools/mturk';
import * as Training from './training';
import * as Evaluation from './dataset-tools/evaluation';
import * as ParserClient from './prediction/parserclient';
import ExactMatcher from './prediction/exact';

import * as I18n from './i18n';
import parallelize from './utils/parallelize';
import * as EntityUtils from './utils/entity-utils';
import * as IpAddressUtils from './engine/util/ip_address';
import * as ThingTalkUtils from './utils/thingtalk';
import * as StreamUtils from './utils/stream-utils';
import * as BTrie from './utils/btrie';

import SpeechHandler from './speech/speech_handler';
import AssistantEngine from './engine';
import * as EngineModules from './engine';
import * as DialogueAgent from './dialogue-runtime';

import BatchSentenceGenerator from './sentence-generator/batch-sentence';
import DialogueGenerator from './sentence-generator/dialogue-generator';
import SentenceGenerator from './sentence-generator/generator';
import * as SentenceGeneratorRuntime from './sentence-generator/runtime';
import * as SentenceGeneratorTypes from './sentence-generator/types';
import * as CommonTemplates from './templates/common.genie.out';
import * as TransactionPolicy from './transaction-dialogues';
import ThingpediaLoader from './templates/load-thingpedia';

export {
    // sentence generation
    BatchSentenceGenerator,
    DialogueGenerator,
    SentenceGenerator,
    SentenceGeneratorRuntime,
    SentenceGeneratorTypes,
    CommonTemplates,
    TransactionPolicy,
    ThingpediaLoader,

    // dataset manipulation
    DatasetParser,
    DatasetStringifier,
    DatasetAugmenter,
    DatasetSplitter,
    DialogueParser,
    DialogueSerializer,

    // the various modules inside Genie
    I18n,
    MTurk,
    Training,
    Evaluation,
    ParserClient,
    ExactMatcher,
    DialogueAgent,
    SpeechHandler,
    AssistantEngine,
    EngineModules,

    // semi-unstable API
    parallelize,
    EntityUtils,
    IpAddressUtils,
    ThingTalkUtils,
    StreamUtils,
    BTrie,
};
