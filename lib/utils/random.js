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

const assert = require('assert');

function choose(from, n, rng = Math.random) {
    if (n === 0)
        return [];
    if (n >= from.length)
        return from;

    let taken = [];
    function next() {
        let idx = Math.floor(rng()*(from.length - taken.length));
        for (let i = 0; i < from.length; i++) {
            if (taken[i])
                continue;
            if (idx === 0) {
                taken[i] = true;
                return from[i];
            }
            idx--;
        }

        throw new assert.AssertionError(`code should not be reached`);
    }

    let res = [];
    while (n > 0) {
        res.push(next());
        n--;
    }
    return res;
}

function coin(prob, rng = Math.random) {
    return rng() <= prob;
}
function uniform(array, rng = Math.random) {
    return array[Math.floor(rng() * array.length)];
}
function categorical(weights, rng = Math.random) {
    const cumsum = new Array(weights.length);
    cumsum[0] = weights[0];
    for (let i = 1; i < weights.length; i++)
        cumsum[i] = cumsum[i-1] + weights[i];

    const value = rng() * cumsum[cumsum.length-1];

    for (let i = 0; i < weights.length; i++) {
        if (value <= cumsum[i])
            return i;
    }
    return cumsum.length-1;
}

function swap(array, i, j) {
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
}

// inplace array shuffle
function shuffle(array, rng = Math.random) {
    for (let i = 0; i < array.length-1; i++) {
        const idx = Math.floor(rng() * (array.length - i));
        swap(array, i, i+idx);
    }
}

function randint(low, high, rng = Math.random) {
    return Math.round(low + (high - low) * rng());
}

class ReservoirSampler {
    constructor(targetSize, rng) {
        this._targetSize = targetSize;
        this._rng = rng;

        this._counter = 0;
        this._reservoir = [];
    }

    get length() {
        return this._reservoir.length;
    }

    [Symbol.iterator]() {
        return this._reservoir[Symbol.iterator]();
    }

    get counter() {
        return this._counter;
    }

    get sampled() {
        return this._reservoir;
    }

    reset() {
        this._counter = 0;
        this._reservoir = [];
    }

    add(element) {
        this._counter ++;
        if (this._reservoir.length < this._targetSize) {
            this._reservoir.push(element);
            return undefined;
        } else {
            const num = randint(0, this._counter-1, this._rng);
            if (num < this._reservoir.length) {
                const old = this._reservoir[num];
                this._reservoir[num] = element;
                return old;
            } else {
                return element;
            }
        }
    }
}

module.exports = {
    ReservoirSampler,
    coin,
    uniform,
    choose,
    categorical,
    shuffle,
    randint
};
