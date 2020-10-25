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

import TimedReference from '../../lib/engine/util/timed_ref';

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function testBasic() {
    let acquired = 0;
    let released = false;

    // expires in 1 second after release, does not autoexpire
    const ref = new TimedReference(1000, false, () => {
        assert.strictEqual(released, false);
        released = true;
    });

    const value = await ref.acquire(() => {
        assert.strictEqual(acquired, 0);
        acquired ++;
        return 42;
    });
    assert.strictEqual(value, 42);

    const value2 = await ref.acquire(() => {
        // value2 should be cached
        assert.fail(`value should not be acquired again`);
    });
    assert.strictEqual(value2, 42);

    // should not expire on its own
    await delay(2000);

    const value3 = await ref.acquire(() => {
        // value2 should be cached
        assert.fail(`value should not be acquired again`);
    });
    assert.strictEqual(value3, 42);

    await ref.release();

    // immediately after release it's still valid
    assert.strictEqual(released, false);

    // wait until expiration
    await delay(2000);
    assert.strictEqual(released, true);

    // we can acquire it again
    const value5 = await ref.acquire(() => {
        assert.strictEqual(acquired, 1);
        acquired ++;
        return 43;
    });
    assert.strictEqual(value5, 43);
}

async function testAutorelease() {
    let acquired = 0;
    let released = false;

    // expires in 1 second after release, and autoexpires
    const ref = new TimedReference(1000, true, () => {
        assert.strictEqual(released, false);
        released = true;
    });

    const value = await ref.acquire(() => {
        assert.strictEqual(acquired, 0);
        acquired ++;
        return 42;
    });
    assert.strictEqual(value, 42);

    const value2 = await ref.acquire(() => {
        // value2 should be cached
        assert.fail(`value should not be acquired again`);
    });
    assert.strictEqual(value2, 42);

    // should expire on its own
    assert.strictEqual(released, false);
    await delay(2000);
    assert.strictEqual(released, true);
}

async function testReleaseNow() {
    let acquired = 0;
    let released = false;

    // expires in 1 second after release, does not autoexpire
    const ref = new TimedReference(1000, false, () => {
        assert.strictEqual(released, false);
        released = true;
    });

    const value = await ref.acquire(() => {
        assert.strictEqual(acquired, 0);
        acquired ++;
        return 42;
    });
    assert.strictEqual(value, 42);

    await ref.release();

    // immediately after release it's still valid
    assert.strictEqual(released, false);

    await ref.releaseNow();
    assert.strictEqual(released, true);
}

async function testParallel() {
    let acquired = 0;
    let released = false;

    // expires in 1 second after release, does not autoexpire
    const ref = new TimedReference(1000, false, () => {
        assert.strictEqual(released, false);
        released = true;
    });

    const value1 = ref.acquire(async () => {
        assert.strictEqual(acquired, 0);
        acquired ++;
        await delay(2000);
        assert.strictEqual(acquired, 1);
        return 42;
    });
    // in parallel, try to acquire again
    const value2 = ref.acquire(() => {
        // value2 should use the first acquire call
        assert.fail(`value should not be acquired again`);
    });

    assert.strictEqual(await value1, 42);
    assert.strictEqual(await value2, 42);
}

async function main() {
    await Promise.all([
        testBasic(),
        testAutorelease(),
        testReleaseNow(),
        testParallel()
    ]);
}
export default main;
if (!module.parent)
    main();
