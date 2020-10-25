// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details


import assert from 'assert';
import * as seedrandom from 'seedrandom';

import PriorityQueue from '../../lib/utils/priority_queue';

function testBasic() {
    const queue = new PriorityQueue();

    assert.strictEqual(queue.size, 0);
    assert.strictEqual(queue.pop(), undefined);

    queue.push({ priority: 0 });
    assert.strictEqual(queue.size, 1);
    assert.deepStrictEqual(queue.pop(), { priority: 0 });
    assert.strictEqual(queue.size, 0);

    queue.push({ priority: 0 });
    queue.push({ priority: 3 });
    queue.push({ priority: 2 });
    queue.push({ priority: 1 });
    queue.push({ priority: 4 });

    assert.strictEqual(queue.size, 5);
    assert.deepStrictEqual(queue.pop(), { priority: 4 });
    assert.deepStrictEqual(queue.pop(), { priority: 3 });
    assert.deepStrictEqual(queue.pop(), { priority: 2 });
    assert.deepStrictEqual(queue.pop(), { priority: 1 });
    assert.deepStrictEqual(queue.pop(), { priority: 0 });
    assert.strictEqual(queue.size, 0);

    queue.push({ priority: 4 });
    queue.push({ priority: 3 });
    queue.push({ priority: 7 });
    queue.push({ priority: 2 });
    queue.push({ priority: 1 });
    queue.push({ priority: 5 });
    queue.push({ priority: 3 });
    queue.push({ priority: 2 });

    assert.strictEqual(queue.size, 8);
    assert.deepStrictEqual(queue.pop(), { priority: 7 });
    assert.deepStrictEqual(queue.pop(), { priority: 5 });
    assert.deepStrictEqual(queue.pop(), { priority: 4 });
    assert.deepStrictEqual(queue.pop(), { priority: 3 });
    assert.deepStrictEqual(queue.pop(), { priority: 3 });
    assert.deepStrictEqual(queue.pop(), { priority: 2 });
    assert.deepStrictEqual(queue.pop(), { priority: 2 });
    assert.deepStrictEqual(queue.pop(), { priority: 1 });
    assert.strictEqual(queue.size, 0);
}

function testTieBreak() {
    const queue = new PriorityQueue();

    assert.strictEqual(queue.size, 0);

    queue.push({ priority: 0, id: 0 });
    queue.push({ priority: 3, id: 1 });
    queue.push({ priority: 0, id: 2 });
    queue.push({ priority: 4, id: 3 });
    queue.push({ priority: 4, id: 4 });
    queue.push({ priority: 2, id: 5 });
    queue.push({ priority: 1, id: 6 });

    assert.deepStrictEqual(queue.pop(), { priority: 4, id: 3 });
    assert.deepStrictEqual(queue.pop(), { priority: 4, id: 4 });
    assert.deepStrictEqual(queue.pop(), { priority: 3, id: 1 });
    assert.deepStrictEqual(queue.pop(), { priority: 2, id: 5 });
    assert.deepStrictEqual(queue.pop(), { priority: 1, id: 6 });
    assert.deepStrictEqual(queue.pop(), { priority: 0, id: 0 });
    assert.deepStrictEqual(queue.pop(), { priority: 0, id: 2 });
}

function getLeftChild(node) {
    return 2*node+1;
}
function getRightChild(node) {
    return 2*node+2;
}

function checkHeap(storage) {
    for (let node = 0; node < storage.length; node++) {
        const lchild = getLeftChild(node);
        const rchild = getRightChild(node);
        if (lchild < storage.length)
            assert(storage[lchild].priority <= storage[node].priority);
        if (rchild < storage.length)
            assert(storage[rchild].priority <= storage[node].priority);
    }
}

function testInvariant() {
    const rng = seedrandom.alea('almond is awesome');
    const queue = new PriorityQueue;

    let max = -1;
    for (let i = 0; i < 100; i++) {
        let priority = Math.round(rng() * 20);
        queue.push({ priority, id: i });
        assert.strictEqual(queue.size, i+1);
        checkHeap(queue._storage);
        max = Math.max(priority, max);
    }

    assert(max >= 0);
    assert.strictEqual(queue.size, 100);

    let last = undefined;
    for (let i = 0; i < 100; i++) {
        const next = queue.pop();
        if (i === 0) {
            assert.strictEqual(next.priority, max);
            last = next;
        } else {
            // no duplicate elements
            assert(next.id !== last.id);
            // either strictly less than last, or added afterwards
            assert(next.priority < last.priority || next.id > last.id);
        }
        checkHeap(queue._storage);
    }

    assert.strictEqual(queue.size, 0);
}

function main() {
    testBasic();
    testTieBreak();
    testInvariant();
}
export default main;
if (!module.parent)
    main();
