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
import { toNFA } from '../../lib/pos-parser/nfa';

const TEST_CASES = [
    [
        '( show me | find me | find | search for ) ( a | ε ) [ . * $value . * ] $domain', ['restaurant', 'diner'], 'chinese',
        [
            ['Show me a Chinese restaurant', '$value'],
            ['search for a Chinese diner', '$value'],
            ['find me Chinese restaurants', '$value'],
            ['search me a Chinese restaurant', null],
        ]
    ],
    [
        '( show me | find me | find | search for ) ( a | ε ) $domain that [ ( VBP | VBD | VBZ ) . * $value . * ]', ['restaurant', 'diner'], 'chinese',
        [
            ['Show me a restaurant that serves Chinese food', 'serves $value food'],
            ['search for a diner that serves good traditional Chinese style food', 'serves good traditional $value style food'],
            ['find me diners that serve chinese dishes.', 'serve $value dishes'],
            ['Show me a restaurant that Chinese food is served', null],
        ]
    ]
];

function main() {
    for (const [template, domainCanonicals, value, examples] of TEST_CASES) {
        const nfa = toNFA(template.split(' '));
        for (const [utterance, expectedMatch] of examples)
            assert.strictEqual(nfa.match(utterance, domainCanonicals, value), expectedMatch);
    }
}

export default main;
if (require.main === module)
    main();

