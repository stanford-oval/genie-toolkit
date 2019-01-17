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
const ThingTalk = require('thingtalk');

async function parseProgram(engine, code) {
    return ThingTalk.Grammar.parseAndTypecheck(code, engine.schemas, true);
}

module.exports = async function testPermissions(engine) {
    const permissions = engine.permissions;

    assert.deepStrictEqual(permissions.getAllPermissions(), []);

    const prog1 = await parseProgram(engine, `now => @org.thingpedia.builtin.test.eat_data(data='foo');`);
    assert.deepStrictEqual(await permissions.checkCanBeAllowed('mock:user1', prog1), false);
    assert.deepStrictEqual(await permissions.checkIsAllowed('mock:user1', prog1), null);

    const permrule = await parseProgram(engine, `source == "mock:user1"^^tt:contact("User 1") :
        now => @org.thingpedia.builtin.test.eat_data, starts_with(data, 'foo');`);
    const description = ThingTalk.Describe.describePermissionRule(engine.platform.getCapability('gettext'), permrule);
    const permruleId = await permissions.addPermission(permrule, description, {
        metadataKey: 'value1'
    });

    assert.deepStrictEqual(permissions.getAllPermissions(), [{
        uniqueId: permruleId,
        rule: permrule,
        code: permrule.prettyprint(),
        description: `User 1 is allowed to consume any data if the data starts with “foo”`,
        metadata: {
            $description: `User 1 is allowed to consume any data if the data starts with “foo”`,
            metadataKey: 'value1'
        }
    }]);

    assert.deepStrictEqual(await permissions.checkCanBeAllowed('mock:user1', prog1), true);
    assert.deepStrictEqual((await permissions.checkIsAllowed('mock:user1', prog1)).prettyprint(), prog1.prettyprint());

    assert.deepStrictEqual(await permissions.checkCanBeAllowed('mock:user2', prog1), false);
    assert.deepStrictEqual(await permissions.checkIsAllowed('mock:user2', prog1), null);

    const prog2 = await parseProgram(engine, `now => @org.thingpedia.builtin.test.eat_data(data='bar');`);
    assert.deepStrictEqual(await permissions.checkCanBeAllowed('mock:user1', prog2), false);
    assert.deepStrictEqual(await permissions.checkIsAllowed('mock:user1', prog2), null);

    await permissions.removePermission(permruleId);

    assert.deepStrictEqual(permissions.getAllPermissions(), []);
    assert.deepStrictEqual(await permissions.checkCanBeAllowed('mock:user1', prog1), false);
    assert.deepStrictEqual(await permissions.checkIsAllowed('mock:user1', prog1), null);
};
