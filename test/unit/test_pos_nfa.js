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
    ['a | b', ['a', 'b'], ['ab', '']],
    ['a * | b c ( d | f )', ['a a', 'b c d'], ['a c d', 'b c d f']]
];

function main() {
    for (const [template, matchExamples, unmatchExamples] of TEST_CASES) {
        const nfa = toNFA(template.split(' '));
        for (const example of matchExamples)
            assert(nfa.match(example.split(' ')));
        for (const example of unmatchExamples)
            assert(!nfa.match(example.split(' ')));
    }
}

export default main;
if (require.main === module)
    main();

