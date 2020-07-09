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

const TimedReference = require('../../lib/engine/util/timed_ref');

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
module.exports = main;
if (!module.parent)
    main();
