// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2018 Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// Miscellaneous unit tests, for simple code fragments that don't need
// a lot of mocking and fixtures

const assert = require('assert');

const Helpers = require('../lib/helpers');

function testFindPrimaryIdentity() {
    assert.strictEqual(Helpers.findPrimaryIdentity(['foo:bar']), 'foo:bar');
    assert.strictEqual(Helpers.findPrimaryIdentity(['foo:bar', 'foo:baz']), 'foo:bar');

    assert.strictEqual(Helpers.findPrimaryIdentity(['email:bob@gmail.com']), 'email:bob@gmail.com');
    assert.strictEqual(Helpers.findPrimaryIdentity(['email:bob@gmail.com', 'email:bob2@gmail.com']), 'email:bob@gmail.com');
    assert.strictEqual(Helpers.findPrimaryIdentity(['email:bob2@gmail.com', 'email:bob@gmail.com']), 'email:bob2@gmail.com');
    assert.strictEqual(Helpers.findPrimaryIdentity(['email:bob@gmail.com', 'foo:bar']), 'email:bob@gmail.com');
    assert.strictEqual(Helpers.findPrimaryIdentity(['foo:bar', 'email:bob@gmail.com']), 'email:bob@gmail.com');

    assert.strictEqual(Helpers.findPrimaryIdentity(['email:bob@gmail.com', 'phone:1234']), 'phone:1234');
    assert.strictEqual(Helpers.findPrimaryIdentity(['phone:1234', 'email:bob@gmail.com']), 'phone:1234');
    assert.strictEqual(Helpers.findPrimaryIdentity(['foo:bar', 'phone:1234']), 'phone:1234');
    assert.strictEqual(Helpers.findPrimaryIdentity(['foo:bar', 'phone:1234', 'phone:5678']), 'phone:1234');
}

function testCleanKind() {
    assert.strictEqual(Helpers.cleanKind('uk.co.thedogapi'), 'Thedogapi');
    assert.strictEqual(Helpers.cleanKind('org.thingpedia.weather'), 'Weather');
    assert.strictEqual(Helpers.cleanKind('com.bing'), 'Bing');
    assert.strictEqual(Helpers.cleanKind('gov.nasa'), 'Nasa');
    assert.strictEqual(Helpers.cleanKind('org.thingpedia.builtin.test'), 'Test');
    assert.strictEqual(Helpers.cleanKind('org.thingpedia.builtin.thingengine.phone'), 'Phone');
    assert.strictEqual(Helpers.cleanKind('org.coinbin'), 'Coinbin');

    assert.strictEqual(Helpers.cleanKind('com.made.up'), 'Made Up');
    assert.strictEqual(Helpers.cleanKind('com.two-words'), 'Two Words');
    assert.strictEqual(Helpers.cleanKind('org.under_score'), 'Under Score');
}

function main() {
    testFindPrimaryIdentity();
    testCleanKind();
}
module.exports = main;
if (!module.parent)
    main();
