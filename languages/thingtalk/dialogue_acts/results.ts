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


import assert from 'assert';

import * as C from '../ast_manip';
import {
    ContextInfo
} from '../state_manip';
import { SlotBag } from '../slot_bag';

import {
    isInfoPhraseCompatibleWithResult,
} from './common';

function checkInfoPhrase(ctx : ContextInfo, info : SlotBag) {
    if (info.schema !== null) {
        if (!C.isSameFunction(ctx.currentFunctionSchema!, info.schema))
            return null;
    }

    // check that the filter uses the right set of parameters
    const resultInfo = ctx.resultInfo!;
    if (resultInfo.projection !== null) {
        // check that all projected names are present
        for (const name of resultInfo.projection) {
            if (!info.has(name))
                return null;
        }
    } else {
        // we must have at least one result to be here
        const topResult = ctx.results![0];
        assert(topResult);

        // check that the names are part of the #[default_projection], if one is specified
        for (const name of info.keys()) {
            if (!topResult.value[name])
                return null;
        }
    }

    // check that the filter is compatible with at least one of the top 3 results
    let good = false;
    const results = ctx.results!;
    for (let i = 0; i < Math.min(3, results.length); i++) {
        if (isInfoPhraseCompatibleWithResult(results[i], info)) {
            good = true;
            break;
        }
    }

    if (good) {
        if (info.schema !== null)
            return info;

        const clone = info.clone();
        clone.schema = ctx.currentFunctionSchema;
        return clone;
    } else {
        return null;
    }
}

export {
    checkInfoPhrase
};
