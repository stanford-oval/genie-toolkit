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
import { infixToPostfix } from '../../lib/pos-parser/infix-to-postfix';

const TEST_CASES = [
    // basics (concat, closure, union)
    ['a', 'a'],
    ['a b', 'a b _'],
    ['a * b', 'a * b _'],
    ['a * | b c', 'a * b c _ |'],
    ['( a * | b ) c', 'a * b | c _'],
    ['a b *', 'a b * _'],

    // wild card
    ['a . *', 'a . * _'],

    // capturing group
    ['a [ b ]', 'a [ b _ ]'],
    ['a [ . * c ]', 'a [ . * _ c _ ]'],
    ['[ a ]', '[ a ]'],
    ['. * [ a ]', '. * [ a _ ]'],
    ['. * [ a ] . *', '. * [ a _ ] . * _'],
    ['[ . * ] a', '[ . * ] a _'],
    ['[ . * a ]', '[ . * a _ ]']
];

function main() {
    for (const [infix, expectedPostfix] of TEST_CASES) {
        const postfix = infixToPostfix(infix.split(' '));
        assert.strictEqual(postfix.join(' '), expectedPostfix);
    }
}

export default main;
if (require.main === module)
    main();

