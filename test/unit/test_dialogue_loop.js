// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Jake Wu <jmhw0123@gmail.com>

import assert from 'assert';

import * as constants from '../../lib/dialogue-agent/dialogue-loop';
import { pickHandler } from '../../lib/dialogue-agent/dialogue-loop';

const thingtalk = {uniqueId: 'thingtalk', priority: 2};
const bing = {uniqueId: 'bing', priority: 1};

const TEST_CASES = [
    // #1
    [
        null,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND}}
        ],
        'thingtalk'
    ],

    // #2
    [
         null,
         [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND}}
         ],
         'thingtalk'
    ],

    // #3
    [
         null,
         [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND}}
         ],
         'bing'
    ],

    // #4
    [
         null,
         [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND}}
         ],
         'thingtalk'
    ],

    // #5
    [
        null,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND}}
        ],
        'bing'
    ],

    // #6
    [
        null,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND}}
        ],
        'thingtalk'
    ],

    // #7
    [
        null,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND}}
        ],
        'thingtalk'
    ],

    // #8
    [
        null,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND}}
        ],
        'thingtalk'
    ],

    // #9
    [
        null,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND}}
        ],
        'bing'
    ],

    // #10
    [
        thingtalk,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_FOLLOWUP}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_FOLLOWUP}}
        ],
        'thingtalk'
    ],

    // #11
    [
        thingtalk,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_FOLLOWUP}}
        ],
        'thingtalk'
    ],

    // #12
    [
        thingtalk,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.EXACT_IN_DOMAIN_FOLLOWUP}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP}}
        ],
        'thingtalk'
    ],

    // #13
    [
        thingtalk,
        [
            {handler: thingtalk, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP}},
            {handler: bing, analysis: {type: constants.CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP}}
        ],
        'thingtalk'
    ],

];

async function test(i, reverse=false) {
    if (reverse)
        console.log('Test Case # %d [reverse]', (i+1));
    else
    console.log('Test Case #' + (i+1));
    let [currentHandler, testCase, expected] = TEST_CASES[i];
    const best = undefined;
    const bestanalysis = undefined;
    if (reverse)
        testCase.reverse();
    const [handler, analysis] = pickHandler(currentHandler,
                                            testCase,
                                            best,
                                            bestanalysis,
                                            constants.Confidence.NO);
    console.log("handler: %O | analysis: %O", handler, analysis);
    assert.strictEqual(handler.uniqueId, expected);
}

async function main() {
    for (let i = 0; i < TEST_CASES.length; i++)
        await test(i, false);
    for (let i = 0; i < TEST_CASES.length; i++)
        await test(i, true);
}
export default main;
if (!module.parent)
    main();
