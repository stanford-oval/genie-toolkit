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

import assert from 'assert';
import RestartableAsyncIterable from '../../lib/engine/util/restartable_async_iterable';

let _g1BeginCount = 0;
let _g1EndCount = 0;
async function* g1() {
    _g1BeginCount ++;
    for (let i = 0; i < 10; i++)
        yield i;
    _g1EndCount ++;
}

let _g2BeginCount = 0;
let _g2EndCount = 0;
function* g2() {
    _g2BeginCount ++;
    for (let i = 10; i > 0; i--)
        yield i;
    _g2EndCount ++;
}

async function iterateN(iterable, n = Infinity) {
    const result = [];
    for await (const el of iterable) {
        result.push(el);
        if (result.length >= n)
            break;
    }
    return result;
}

async function testBasic() {
    const i1 = new RestartableAsyncIterable(g1());

    assert.strictEqual(_g1BeginCount, 0);
    assert.strictEqual(_g1EndCount, 0);
    assert.deepStrictEqual(await iterateN(i1), [0,1,2,3,4,5,6,7,8,9]);
    assert.strictEqual(_g1BeginCount, 1);
    assert.strictEqual(_g1EndCount, 1);

    // same thing, but with a sync iterator
    const i2 = new RestartableAsyncIterable(g2());

    assert.strictEqual(_g2BeginCount, 0);
    assert.strictEqual(_g2EndCount, 0);
    assert.deepStrictEqual(await iterateN(i2), [10,9,8,7,6,5,4,3,2,1]);
    assert.strictEqual(_g2BeginCount, 1);
    assert.strictEqual(_g2EndCount, 1);
}


async function testRestart() {
    const i1 = new RestartableAsyncIterable(g1());

    // iterate the first time
    assert.strictEqual(_g1BeginCount, 1);
    assert.strictEqual(_g1EndCount, 1);
    assert.deepStrictEqual(await iterateN(i1), [0,1,2,3,4,5,6,7,8,9]);
    assert.strictEqual(_g1BeginCount, 2);
    assert.strictEqual(_g1EndCount, 2);

    // iterate the second time
    assert.deepStrictEqual(await iterateN(i1), [0,1,2,3,4,5,6,7,8,9]);
    assert.strictEqual(_g1BeginCount, 2);
    assert.strictEqual(_g1EndCount, 2);
}

async function testInterrupt() {
    const i1 = new RestartableAsyncIterable(g1());

    // iterate the first 5 elements
    const iterator = i1[Symbol.asyncIterator]();
    assert.strictEqual(_g1BeginCount, 2);
    assert.strictEqual(_g1EndCount, 2);
    assert.deepStrictEqual(await iterateN(iterator, 5), [0,1,2,3,4]);
    assert.strictEqual(_g1BeginCount, 3);
    assert.strictEqual(_g1EndCount, 2);

    // iterate from the beginning
    // the first 5 elements will be cached and the second will be fetched
    assert.deepStrictEqual(await iterateN(i1), [0,1,2,3,4,5,6,7,8,9]);
    assert.strictEqual(_g1BeginCount, 3);
    assert.strictEqual(_g1EndCount, 3);

    // complete the first iterator
    assert.deepStrictEqual(await iterateN(iterator), [5,6,7,8,9]);
    assert.strictEqual(_g1BeginCount, 3);
    assert.strictEqual(_g1EndCount, 3);
}

async function testParallel() {
    const i1 = new RestartableAsyncIterable(g1());

    assert.strictEqual(_g1BeginCount, 3);
    assert.strictEqual(_g1EndCount, 3);
    const p1 = iterateN(i1);
    const p2 = iterateN(i1);
    assert.strictEqual(_g1BeginCount, 4);
    assert.strictEqual(_g1EndCount, 3);

    const [c1, c2] = await Promise.all([p1, p2]);
    assert.strictEqual(_g1BeginCount, 4);
    assert.strictEqual(_g1EndCount, 4);

    assert.deepStrictEqual(c1, [0,1,2,3,4,5,6,7,8,9]);
    assert.deepStrictEqual(c2, [0,1,2,3,4,5,6,7,8,9]);
}

async function main() {
    await testBasic();
    await testRestart();
    await testInterrupt();
    await testParallel();
}
export default main;
if (!module.parent)
    main();
