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


import * as seedrandom from 'seedrandom';
import assert from 'assert';

import * as random from '../../lib/utils/random';

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

function testCategorical(rng) {
    let weights = [1, 0, 1, 2];
    let samples = [0, 0, 0, 0];

    for (let i = 0; i < 10000; i++) {
        const sample = random.categorical(weights, rng);
        assert(sample >= 0);
        assert(sample <= 3);
        samples[sample] += 1;
    }

    assert.deepStrictEqual(samples, [ 2481, 0, 2498, 5021 ]);

    weights = [0, 0, 0, 1];
    samples = [0, 0, 0, 0];

    for (let i = 0; i < 10000; i++) {
        const sample = random.categorical(weights, rng);
        assert(sample >= 0);
        assert(sample <= 3);
        samples[sample] += 1;
    }

    assert.deepStrictEqual(samples, [ 0, 0, 0, 10000 ]);

    weights = [1, 0, 0, 0];
    samples = [0, 0, 0, 0];

    for (let i = 0; i < 10000; i++) {
        const sample = random.categorical(weights, rng);
        assert(sample >= 0);
        assert(sample <= 3);
        samples[sample] += 1;
    }

    assert.deepStrictEqual(samples, [ 10000, 0, 0, 0 ]);
}

function testCategoricalPrecomputed(rng) {
    let cumsum = [1, 2, 3, 4];
    let samples = [0, 0, 0, 0];

    for (let i = 0; i < 10000; i++) {
        const sample = random.categoricalPrecomputed(cumsum, cumsum.length, rng);
        assert(sample >= 0);
        assert(sample <= 3);
        samples[sample] += 1;
    }
    assert.deepStrictEqual(samples, [ 2479, 2452, 2546, 2523 ]);

    samples = [0, 0, 0, 0];
    for (let i = 0; i < 10000; i++) {
        const sample = random.categoricalPrecomputed(cumsum, cumsum.length-1, rng);
        assert(sample >= 0);
        assert(sample <= 3);
        samples[sample] += 1;
    }
    assert.deepStrictEqual(samples, [ 3330, 3366, 3304, 0 ]);

    cumsum = [0, 0, 0, 1];
    samples = [0, 0, 0, 0];
    for (let i = 0; i < 10000; i++) {
        const sample = random.categoricalPrecomputed(cumsum, cumsum.length, rng);
        assert(sample >= 0);
        assert(sample <= 3);
        samples[sample] += 1;
    }
    assert.deepStrictEqual(samples, [ 0, 0, 0, 10000 ]);

    cumsum = [0, 0, 1, 1];
    samples = [0, 0, 0, 0];
    for (let i = 0; i < 10000; i++) {
        const sample = random.categoricalPrecomputed(cumsum, cumsum.length, rng);
        assert(sample >= 0);
        assert(sample <= 3);
        samples[sample] += 1;
    }
    assert.deepStrictEqual(samples, [ 0, 0, 10000, 0 ]);

    cumsum = [0, 0, 1, 2];
    samples = [0, 0, 0, 0];
    for (let i = 0; i < 10000; i++) {
        const sample = random.categoricalPrecomputed(cumsum, cumsum.length, rng);
        assert(sample >= 0);
        assert(sample <= 3);
        samples[sample] += 1;
    }
    assert.deepStrictEqual(samples, [ 0, 0, 5045, 4955 ]);
}


async function main() {
    const rng = seedrandom.alea('test almond');

    await testChoice(rng);
    await testShuffle(rng);
    await testReservoirSampler(rng);
    await testCategorical(rng);
    await testCategoricalPrecomputed(rng);
}

export default main;
if (!module.parent)
    main();
