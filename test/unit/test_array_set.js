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

import ArraySet from '../../lib/engine/util/array_set';

function testBasic() {
    const set = new ArraySet();

    assert.strictEqual(set.size, 0);
    assert(!set.has(1));

    set.add(1);
    assert.strictEqual(set.size, 1);
    assert(set.has(1));

    set.add(2);
    assert.strictEqual(set.size, 2);
    assert(set.has(1));
    assert(set.has(2));
}

function testDuplicate() {
    const set = new ArraySet();

    assert.strictEqual(set.size, 0);
    assert(!set.has(1));

    set.add(1);
    assert.strictEqual(set.size, 1);
    assert(set.has(1));

    set.add(1);
    assert.strictEqual(set.size, 1);
    assert(set.has(1));
}

function testDelete() {
    const set = new ArraySet();

    assert.strictEqual(set.size, 0);
    assert(!set.has(1));

    set.add(1);
    assert.strictEqual(set.size, 1);
    assert(set.has(1));
    assert(!set.has(2));

    set.delete(2);
    assert.strictEqual(set.size, 1);
    assert(set.has(1));
    assert(!set.has(2));

    set.delete(1);
    assert.strictEqual(set.size, 0);
    assert(!set.has(1));
    assert(!set.has(2));
}

function testClear() {
    const set = new ArraySet();

    set.add(1);
    set.add(2);

    assert.strictEqual(set.size, 2);
    assert(set.has(1));
    assert(set.has(2));

    set.clear();

    // after clear, there is nothing in the set
    assert.strictEqual(set.size, 0);
    assert(!set.has(1));
    assert(!set.has(2));

    // after clear, more elements can be added
    set.add(1);
    assert.strictEqual(set.size, 1);
    assert(set.has(1));
    assert(!set.has(2));
}

function testToJSON() {
    const set = new ArraySet();
    set.add(1);
    set.add(2);

    assert.deepStrictEqual(set.toJSON(), [1, 2]);
    assert.strictEqual(JSON.stringify(set), '[1,2]');
}

function testIteration() {
    const set = new ArraySet();
    set.add(1);
    set.add(2);

    assert.deepStrictEqual(Array.from(set), [1, 2]);

    // iteration has no side-effects
    assert.deepStrictEqual(Array.from(set), [1, 2]);

    // other iteration methods
    assert.deepStrictEqual(Array.from(set.keys()), [1, 2]);
    assert.deepStrictEqual(Array.from(set.values()), [1, 2]);
}

export default async function main() {
    testBasic();
    testDuplicate();
    testDelete();
    testClear();
    testIteration();
    testToJSON();
}
if (!module.parent)
    main();
