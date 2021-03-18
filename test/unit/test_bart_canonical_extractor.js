// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Silei Xu <silei@cs.stanford.edu>


import assert from 'assert';

import AnnotationExtractor from '../../tool/autoqa/lib/canonical-extractor';

const TEST_CASES = [
    [
        "Show me the Swedish album.",
        "Swedish",
        "album",
        { adjective: ["#"] }
    ],
    [
        "Show me the Izakaya restaurant.",
        "Izakaya",
        "restaurant",
        { adjective: ["#"] }
    ],
    [
        "Show me a Laotian cuisine restaurant.",
        "Laotian",
        "restaurant",
        { adjective: ["# cuisine"] }
    ],
    [
        "Which review did Rick M. write?",
        "Rick M.",
        "review",
        { verb: ["# write"], reverse_verb_projection: ["write"] }
    ],
    [
        "Show me a person who has won a national scholarship.",
        "national scholarship",
        "person",
        { verb: ["has won a #"] }
    ],
    [
        "Who went to Cleveland State?",
        "cleveland state",
        "person",
        { verb: ["went to #"] }
    ],
    [
        "Which review was published on Feb 14 2017?",
        "feb 14 2017",
        "review",
        { passive_verb: ["published on #"] }
    ],
    [
        "Which review is by Stephanie Q.?",
        "stephanie q.",
        "review",
        { preposition: ["by #"] }
    ],
    [
        "what restaurant is rated four stars?",
        "4",
        "restaurant",
        { passive_verb: ["rated # stars"] }
    ],
    [
        "Show me restaurant rated 4.",
        "4",
        "restaurant",
        { passive_verb: ["rated #"] }
    ],
    [
        "show me that nitidus song",
        "nitidus",
        "song",
        { adjective: ['#'] }
    ],
    [
        "what song does nitidus play?",
        "nitidus",
        "song",
        { verb: ['# play'], reverse_verb_projection: ["play"] }
    ],
    [
        "what's eddy clearwater's song?",
        "eddy clearwater",
        "song",
        { adjective: ['# \'s'] }
    ]
];

function main() {
    const extractor = new AnnotationExtractor(null, [], null, {});

    let anyFailed = false;
    for (let [paraphrase, value, query_canonical, expected] of TEST_CASES) {
        const canonical = {};
        extractor._extractOneCanonical(canonical, paraphrase, value, query_canonical);
        try {
            assert.deepStrictEqual(canonical, expected);
        } catch(e) {
            console.error(`Test case "${paraphrase}" failed`);
            console.error(e);
            anyFailed = true;
        }
    }
    if (anyFailed)
        throw new Error('Some test failed');
}
export default main;
if (!module.parent)
    main();
