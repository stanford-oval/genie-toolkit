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

/**
 * A single possible parse for an input sentence.
 */
export interface PredictionCandidate {
    /**
     * The ThingTalk code corresponding to this parse, as a sequence of tokens.
     *
     * This code should be passed to the {@link ThingTalk.Syntax.parse} API together
     * with the {@link PredictionResult.entities} field.
     */
    code : string[];

    /**
     * A score indicating how likely it is that the parse is correct.
     *
     * There is no guarantee on the range of this score, but a score
     * higher than 0.5 indicates the model is very confident that the parse is correct.
     *
     * A score of "Infinity" indicates that the model matched the sentence exactly
     * to some sentence in the training data and therefore the parse is guaranteed to
     * be correct.
     */
    score : number|'Infinity';
}

/**
 * The result of calling the NLU web API.
 */
export interface PredictionResult {
    result : 'ok';

    /**
     * The tokens in the input sentence.
     */
    tokens : string[];
    /**
     * The entities in the input sentence, extracted by the tokenizer.
     */
    entities : EntityMap;

    /**
     * A list of candidate ThingTalk parses for the input sentence, sorted
     * by decreasing score.
     */
    candidates : PredictionCandidate[];

    /**
     * The server's best guess of whether this is a command (in-domain),
     * an out of domain command (could be a new function, web question, or
     * chatty sentence), or should be ignored altogether.
     *
     * There is no guarantee on the range of these numbers, but it is guaranteed
     * that the highest number corresponds to the most likely classification
     * of the command.
     */
    intent : {
        /**
         * A score indicating whether the input is recognized as a ThingTalk command.
         */
        command : number;

        /**
         * A score indicating whether the input is "junk" caused by spurious
         * wake-word activation or keyboard mashing, and should be ignored
         * entirely.
         */
        ignore : number;

        /**
         * A score indicating whether the input is some other sort of command
         * not representable in ThingTalk (out-of-domain).
         */
        other : number;
    }
}

export interface GenerationResult {
    answer : string;
    score : number;
}
