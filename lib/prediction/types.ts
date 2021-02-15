// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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

import { EntityMap } from '../utils/entity-utils';

export interface ExactMatcher {
    get(tokens : string[]) : string[][]|null;
}

export interface ParseOptions {
    thingtalk_version ?: string;
    store ?: string;
    answer ?: string;
    expect ?: string;
    choices ?: string[];
    tokenized ?: boolean;
    skip_typechecking ?: boolean;
    example_id ?: string;
}

export interface PredictionCandidate {
    code : string[];
    score : number|'Infinity';
}

// this type matches the NLP web API exactly, including some
// odd aspects around "intent"
export interface PredictionResult {
    result : 'ok';
    tokens : string[];
    entities : EntityMap;
    candidates : PredictionCandidate[];

    // the server's best guess of whether this is a command (in-domain),
    // an out of domain command (could be a new function, web question, or
    // chatty sentence), or should be ignored altogether
    intent : {
        command : number;
        other : number;
        ignore : number;
    }
}

export interface GenerationResult {
    answer : string;
    score : number;
}
