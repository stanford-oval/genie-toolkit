// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ArraySet = require('../../lib/util/array_set');

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

async function main() {
    testBasic();
    testDuplicate();
    testDelete();
    testClear();
    testIteration();
    testToJSON();
}
module.exports = main;
if (!module.parent)
    main();
