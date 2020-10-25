// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


function choose<T>(from : T[], n : number, rng : () => number = Math.random) : T[] {
    if (n === 0)
        return [];
    if (n >= from.length)
        return from;

    const taken : boolean[] = [];
    function next() : T {
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

        throw new Error(`code should not be reached`);
    }

    const res : T[] = [];
    while (n > 0) {
        res.push(next());
        n--;
    }
    return res;
}

function coin(prob : number, rng : () => number = Math.random) : boolean {
    return rng() <= prob;
}
function uniform<T>(array : T[], rng : () => number = Math.random) : T {
    return array[Math.floor(rng() * array.length)];
}
function categorical(weights : number[], rng : () => number = Math.random) : number {
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

function swap<T>(array : T[], i : number, j : number) : void {
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
}

// inplace array shuffle
function shuffle<T>(array : T[], rng : () => number = Math.random) : void {
    for (let i = 0; i < array.length-1; i++) {
        const idx = Math.floor(rng() * (array.length - i));
        swap(array, i, i+idx);
    }
}

function randint(low : number, high : number, rng : () => number = Math.random) : number {
    return Math.round(low + (high - low) * rng());
}

class ReservoirSampler<T> {
    private _targetSize : number;
    private _rng : () => number;
    private _counter : number;
    private _reservoir : T[];

    constructor(targetSize : number, rng : () => number) {
        this._targetSize = targetSize;
        this._rng = rng;

        this._counter = 0;
        this._reservoir = [];
    }

    get length() : number {
        return this._reservoir.length;
    }

    [Symbol.iterator]() : Iterator<T> {
        return this._reservoir[Symbol.iterator]();
    }

    get counter() : number {
        return this._counter;
    }

    get sampled() : T[] {
        return this._reservoir;
    }

    reset() : void {
        this._counter = 0;
        this._reservoir = [];
    }

    add(element : T) : T|undefined {
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

export {
    ReservoirSampler,
    coin,
    uniform,
    choose,
    categorical,
    shuffle,
    randint
};
