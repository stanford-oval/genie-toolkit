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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const seedrandom = require('seedrandom');
const assert = require('assert');

const random = require('../../lib/utils/random');

function testChoice(rng) {
    assert.strictEqual(random.uniform([1,2,3,4], rng), 4);
    assert.strictEqual(random.uniform([1,2,3,4], rng), 2);
    assert.strictEqual(random.uniform([1,2,3,4], rng), 4);
    assert.strictEqual(random.uniform([1,2,3,4], rng), 2);
    assert.strictEqual(random.uniform([1,2,3,4], rng), 3);
    assert.strictEqual(random.uniform([1,2,3,4], rng), 1);
    assert.strictEqual(random.uniform([1,2,3,4], rng), 4);

    assert.strictEqual(random.uniform([4,3,2,1], rng), 2);
    assert.strictEqual(random.uniform([5,6,7,8], rng), 8);
}

function copyshuffle(array, rng) {
    const copy = array.slice();
    random.shuffle(copy, rng);
    return copy;
}

function genArray(length, rng) {
    const arr = new Array(length);
    for (let i = 0; i < length; i++)
        arr[i] = rng()*100;
    return arr;
}

function testShuffle(rng) {
    assert.deepStrictEqual(copyshuffle([1,2,3,4], rng), [1,2,4,3]);
    assert.deepStrictEqual(copyshuffle([1,2,3,4], rng), [4,1,3,2]);
    assert.deepStrictEqual(copyshuffle([1,2,3,4], rng), [3,1,4,2]);

    for (let i = 0; i < 20; i++) {
        const arr = genArray(100, rng);
        const shuffled = copyshuffle(arr, rng);
        arr.sort((a, b) => a - b);
        shuffled.sort((a, b) => a - b);
        assert.deepStrictEqual(shuffled, arr);
    }
}

function testReservoirSampler(rng) {
    const sampler = new random.ReservoirSampler(3, rng);

    for (let i = 0; i < 20; i++)
        sampler.add(i);

    assert.deepStrictEqual(sampler.sampled, [6, 9, 8]);
    assert.deepStrictEqual(Array.from(sampler), [6, 9, 8]);
}

async function main() {
    const rng = seedrandom.alea('test almond');

    await testChoice(rng);
    await testShuffle(rng);
    await testReservoirSampler(rng);
}
module.exports = main;
if (!module.parent)
    main();
