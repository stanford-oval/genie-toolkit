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


import GenieNLP, { GenieNLPConfig } from './genienlp';
import { TrainingJobOptions } from './base_training_job';

const BACKENDS = {
    'genienlp': GenieNLP
};
const DEFAULT_BACKEND = 'genienlp' as const;

export {
    BACKENDS,
    DEFAULT_BACKEND,
};

export function createJob(options : TrainingJobOptions & { backend ?: keyof typeof BACKENDS, config : GenieNLPConfig }) {
    return new BACKENDS[options.backend || DEFAULT_BACKEND](options);
}
