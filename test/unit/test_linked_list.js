// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import assert from 'assert';

import LinkedList from '../../lib/engine/util/linked_list';

function testBasic() {
    const list = new LinkedList();

    assert.strictEqual(list.head, null);
    assert.strictEqual(list.tail, null);
    assert.strictEqual(list.size, 0);

    list.unshift(1);

    assert.strictEqual(list.head.data, 1);
    assert.strictEqual(list.tail.data, 1);
    assert.strictEqual(list.size, 1);

    assert.strictEqual(list.peek(), 1);

    // after peek, nothing changed

    assert.strictEqual(list.head.data, 1);
    assert.strictEqual(list.tail.data, 1);
    assert.strictEqual(list.size, 1);

    // add more elements

    list.unshift(2);

    assert.strictEqual(list.head.data, 2);
    assert.strictEqual(list.tail.data, 1);
    assert.strictEqual(list.size, 2);

    // peek always returns the last element
    // and unshift always modifies the first element
    assert.strictEqual(list.peek(), 1);
}

function testPop() {
    const list = new LinkedList();
    list.unshift(1);

    assert.strictEqual(list.peek(), 1);

    // pop returns the popped element
    assert.strictEqual(list.pop(), 1);

    // now the list is empty
    assert.strictEqual(list.head, null);
    assert.strictEqual(list.tail, null);
    assert.strictEqual(list.size, 0);

    // now with two elements...

    list.unshift(2);
    list.unshift(1);

    assert.strictEqual(list.head.data, 1);
    assert.strictEqual(list.tail.data, 2);
    assert.strictEqual(list.size, 2);

    // pop in the same order as unshift
    assert.strictEqual(list.pop(), 2);
    assert.strictEqual(list.pop(), 1);

    // now the list is empty again
    assert.strictEqual(list.head, null);
    assert.strictEqual(list.tail, null);
    assert.strictEqual(list.size, 0);

    assert.throws(() => list.pop());
}

function testIteration() {
    const list = new LinkedList();
    assert.deepStrictEqual(Array.from(list), []);

    list.unshift(3);
    list.unshift(2);
    list.unshift(1);

    assert.deepStrictEqual(Array.from(list), [1, 2, 3]);
}

async function main() {
    testBasic();
    testPop();
    testIteration();
}
export default main;
if (!module.parent)
    main();
