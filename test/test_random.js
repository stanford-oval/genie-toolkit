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

const seedrandom = require('seedrandom');
const assert = require('assert');

const random = require('../lib/random');

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
