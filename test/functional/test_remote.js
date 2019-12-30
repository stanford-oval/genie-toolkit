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

const uuid = require('uuid');
const assert = require('assert');
const ThingTalk = require('thingtalk');

async function parseProgram(engine, code) {
    return ThingTalk.Grammar.parse(code);
}

async function testInstallProgram(engine) {
    const messaging = engine.messaging;
    const remote = engine.remote;

    const prog1 = await parseProgram(engine, `now => @org.thingpedia.builtin.test.eat_data(data='foo');`);
    const code = prog1.prettyprint(true).trim();
    await new Promise((resolve, reject) => {
        const uniqueId = uuid.v4();

        messaging.on('incoming-message', (feedId, msg) => {
            reject(new Error(`Unexpected message from ${msg.sender}`));
        });
        messaging.once('outgoing-message', (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');
            assert.deepStrictEqual(msg.json, {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'phone:+1555123456',
                c: code,
            });
            resolve();
        });
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        remote.installProgramRemote(['mock-account:user2'], 'phone:+1555123456', uniqueId, prog1).catch(reject);
    });
}

async function testInstallProgramHighLevel(engine) {
    const messaging = engine.messaging;

    const prog1 = await parseProgram(engine, `executor = "mock-account:user2"^^tt:contact : now => @org.thingpedia.builtin.test.eat_data(data='foo');`);
    await prog1.typecheck(engine.schemas, true);
    await new Promise((resolve, reject) => {
        const uniqueId = uuid.v4();

        messaging.on('incoming-message', (feedId, msg) => {
            reject(new Error(`Unexpected message from ${msg.sender}`));
        });
        messaging.once('outgoing-message', (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');
            assert.deepStrictEqual(msg.json, {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'phone:+1555123456',
                c: `now => @org.thingpedia.builtin.test.eat_data(data="foo");`,
            });
            resolve();
        });
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        engine.apps.createApp(prog1, { uniqueId }).catch(reject);
    });
}

async function testHandleInstallNoPermissionNoAssistant(engine) {
    const messaging = engine.messaging;

    const prog1 = await parseProgram(engine, `now => @org.thingpedia.builtin.test.eat_data(data='foo');`);
    const code = prog1.prettyprint(true).trim();
    await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        const uniqueId = uuid.v4();

        let count = 0;
        const listener = (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');

            switch (count) {
            case 0:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'j',
                    uuid: String(uniqueId),
                });
                break;
            case 1:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'a',
                    uuid: String(uniqueId),
                    err: {
                        c: 'EPERM',
                        m: 'User not available to confirm'
                    }
                });

                messaging.removeListener('outgoing-message', listener);
                resolve();
                break;
            default:
                throw new Error('too many messages');
            }
            count++;
        };
        messaging.on('outgoing-message', listener);

        messaging.getFeed('mock:feed1')._sendMessage('user2', {
            type: 'app',
            json: {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'email:alice@example.com',
                c: code,
            }
        });
    });
}

async function testHandleInstallNoPermission(engine) {
    const messaging = engine.messaging;

    const prog1 = await parseProgram(engine, `now => @org.thingpedia.builtin.test.eat_data(data='foo');`);
    const code = prog1.prettyprint(true).trim();
    engine.platform.getCapability('assistant')._setConversation({
        askForPermission(principal, identity, program) {
            assert.strictEqual(principal, 'mock-account:user2');
            assert.strictEqual(identity, 'email:alice@example.com');
            assert.strictEqual(program.prettyprint(true), code);
            return null;
        }
    });

    await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        const uniqueId = uuid.v4();

        let count = 0;
        const listener = (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');

            switch (count) {
            case 0:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'j',
                    uuid: String(uniqueId),
                });
                break;
            case 1:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'a',
                    uuid: String(uniqueId),
                    err: {
                        c: 'EPERM',
                        m: 'Permission denied'
                    }
                });

                messaging.removeListener('outgoing-message', listener);
                resolve();
                break;
            default:
                throw new Error('too many messages');
            }
            count++;
        };
        messaging.on('outgoing-message', listener);

        messaging.getFeed('mock:feed1')._sendMessage('user2', {
            type: 'app',
            json: {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'email:alice@example.com',
                c: code,
            }
        });
    });
}

async function testHandleInstallNoPermissionSMT(engine) {
    const messaging = engine.messaging;

    const permrule = await parseProgram(engine, `source == "mock-messaging:user2"^^tt:contact("User 1") :
        now => @org.thingpedia.builtin.test.eat_data, starts_with(data, 'foo');`);
    const permuuid = await engine.permissions.addPermission(permrule, 'some permission');

    const prog1 = await parseProgram(engine, `now => @org.thingpedia.builtin.test.eat_data(data='bar');`);
    const code = prog1.prettyprint(true).trim();
    engine.platform.getCapability('assistant')._setConversation({
        askForPermission(principal, identity, program) {
            assert.strictEqual(principal, 'mock-account:user2');
            assert.strictEqual(identity, 'email:alice@example.com');
            assert.strictEqual(program.prettyprint(true), code);
            return null;
        }
    });

    await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        const uniqueId = uuid.v4();

        let count = 0;
        const listener = (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');

            switch (count) {
            case 0:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'j',
                    uuid: String(uniqueId),
                });
                break;
            case 1:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'a',
                    uuid: String(uniqueId),
                    err: {
                        c: 'EPERM',
                        m: 'Permission denied'
                    }
                });

                messaging.removeListener('outgoing-message', listener);
                resolve();
                break;
            default:
                throw new Error('too many messages');
            }
            count++;
        };
        messaging.on('outgoing-message', listener);

        messaging.getFeed('mock:feed1')._sendMessage('user2', {
            type: 'app',
            json: {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'email:alice@example.com',
                c: code,
            }
        });
    });

    await engine.permissions.removePermission(permuuid);
}

async function testHandleInstallInvalidIdentity(engine) {
    const messaging = engine.messaging;

    const prog1 = await parseProgram(engine, `now => @org.thingpedia.builtin.test.eat_data(data='foo');`);
    const code = prog1.prettyprint(true).trim();
    await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        const uniqueId = uuid.v4();

        messaging.once('outgoing-message', (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');

            assert.deepStrictEqual(msg.json, {
                v: 3,
                op: 'a',
                uuid: String(uniqueId),
                err: {
                    c: 'EPERM',
                    m: 'Identity does not match principal'
                }
            });
            resolve();
        });

        messaging.getFeed('mock:feed1')._sendMessage('user2', {
            type: 'app',
            json: {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'email:charlie@example.com',
                c: code,
            }
        });
    });
}

async function testHandleInstallTypeError(engine) {
    const messaging = engine.messaging;

    const prog1 = await parseProgram(engine, `now => @org.thingpedia.builtin.test.get_data(data='foo');`);
    const code = prog1.prettyprint(true).trim();
    await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        const uniqueId = uuid.v4();

        messaging.once('outgoing-message', (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');

            assert.deepStrictEqual(msg.json, {
                v: 3,
                op: 'a',
                uuid: String(uniqueId),
                err: {
                    c: 'EINVAL',
                    m: 'Class org.thingpedia.builtin.test has no action get_data'
                }
            });
            resolve();
        });

        messaging.getFeed('mock:feed1')._sendMessage('user2', {
            type: 'app',
            json: {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'email:alice@example.com',
                c: code,
            }
        });
    });
}

async function testHandleInstallOk(engine) {
    const messaging = engine.messaging;

    const prog1 = await ThingTalk.Grammar.parseAndTypecheck(`now => @org.thingpedia.builtin.test.eat_data(data='foo');`, engine.schemas);
    const code = prog1.prettyprint(true).trim();
    const uniqueId = uuid.v4();

    await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        let count = 0;
        const listener = (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');

            switch (count) {
            case 0:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'j',
                    uuid: String(uniqueId),
                });
                break;
            default:
                throw new Error('too many messages');
            }
            count++;
        };
        messaging.once('outgoing-message', listener);

        engine.platform.getCapability('assistant')._setConversation({
            askForPermission(principal, identity, program) {
                assert.strictEqual(principal, 'mock-account:user2');
                assert.strictEqual(identity, 'email:alice@example.com');
                assert.strictEqual(program.prettyprint(true), code);
                return program;
            },

            runProgram(program, uuid, identity) {
                assert.strictEqual(program.prettyprint(true), code);
                assert.strictEqual(uuid, uniqueId);
                assert.strictEqual(identity, 'email:alice@example.com');

                messaging.removeListener('outgoing-message', listener);
                resolve();
            }
        });

        messaging.getFeed('mock:feed1')._sendMessage('user2', {
            type: 'app',
            json: {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'email:alice@example.com',
                c: code,
            }
        });
    });
}

async function testHandleInstallOkPermission(engine) {
    const messaging = engine.messaging;

    const permrule = await parseProgram(engine, `source == "mock-messaging:user2"^^tt:contact("User 1") :
        now => @org.thingpedia.builtin.test.eat_data, starts_with(data, 'foo');`);
    const permuuid = await engine.permissions.addPermission(permrule, 'some permission');

    const prog1 = await ThingTalk.Grammar.parseAndTypecheck(`now => @org.thingpedia.builtin.test.eat_data(data='foo');`, engine.schemas);
    const code = prog1.prettyprint(true).trim();
    const uniqueId = uuid.v4();

    await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        let count = 0;
        const listener = (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');

            switch (count) {
            case 0:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'j',
                    uuid: String(uniqueId),
                });
                break;
            default:
                throw new Error('too many messages');
            }
            count++;
        };
        messaging.on('outgoing-message', listener);

        engine.platform.getCapability('assistant')._setConversation({
            askForPermission(principal, identity, program) {
                assert.strictEqual(principal, 'mock-account:user2');
                assert.strictEqual(identity, 'email:alice@example.com');
                assert.strictEqual(program.prettyprint(true), code);
                return program;
            },

            runProgram(program, uuid, identity) {
                assert.strictEqual(program.prettyprint(true), code);
                assert.strictEqual(uuid, uniqueId);
                assert.strictEqual(identity, 'email:alice@example.com');

                messaging.removeListener('outgoing-message', listener);
                resolve();
            }
        });

        messaging.getFeed('mock:feed1')._sendMessage('user2', {
            type: 'app',
            json: {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'email:alice@example.com',
                c: code,
            }
        });
    });

    await engine.permissions.removePermission(permuuid);
}

async function testHandleInstallOkGet(engine) {
    const messaging = engine.messaging;

    const prog1 = await ThingTalk.Grammar.parseAndTypecheck(`executor = "mock-account:user1"^^tt:contact :
        now => @org.thingpedia.builtin.test.get_data(size=10byte) => return;`, engine.schemas);
    // pass a fake messaging to we send data to user2 not user1
    prog1.lowerReturn({ getSelf() { return 'mock-account:user2'; } });
    prog1.principal = null;

    const code = prog1.prettyprint(true).trim();
    console.log(code);

    const uniqueId = uuid.v4();

    await new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`timed out`)), 20000);

        engine.platform.getCapability('assistant')._setConversation({
            askForPermission(principal, identity, program) {
                assert.strictEqual(principal, 'mock-account:user2');
                assert.strictEqual(identity, 'email:alice@example.com');

                // this assertion does not hold (differs due to ("me") )
                //assert.strictEqual(program.prettyprint(true), code);
                return program;
            },

            runProgram(program, uuid, identity) {
                // this assertion does not hold (differs due to ("me") )
                // assert.strictEqual(program.prettyprint(true), code);

                assert.strictEqual(uuid, uniqueId);
                assert.strictEqual(identity, 'email:alice@example.com');

                engine.apps.loadOneApp(code,
                    {}, uniqueId, undefined, 'some app', 'some app description', true).catch(reject);
            }
        });

        let count = 0;
        const listener = (feedId, msg) => {
            assert.deepStrictEqual(feedId, 'mock:feed1');
            assert.strictEqual(msg.sender, 'mock-account:user1');
            assert.strictEqual(msg.type, 'app');

            switch (count) {
            case 0:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'j',
                    uuid: uniqueId,
                });
                break;
            case 1:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'd',
                    uuid: uniqueId,
                    f: 0,
                    d: {
                        __kindChannel: 'org.thingpedia.builtin.test:get_data',
                        data: '!!!!!!!!!!'
                    },
                });
                break;
            case 2:
                assert.deepStrictEqual(msg.json, {
                    v: 3,
                    op: 'e',
                    uuid: uniqueId,
                    f: 0,
                });

                messaging.removeListener('outgoing-message', listener);
                resolve();
                break;
            default:
                throw new Error('too many messages');
            }
            count++;
        };
        messaging.on('outgoing-message', listener);

        messaging.getFeed('mock:feed1')._sendMessage('user2', {
            type: 'app',
            json: {
                v: 3,
                op: 'i',
                uuid: String(uniqueId),
                id: 'email:alice@example.com',
                c: code,
            }
        });
    });
}

module.exports = async function testRemote(engine) {
    const messaging = engine.messaging;
    //const remote = engine.remote;
    assert(messaging.isAvailable);
    assert(messaging.isSelf('mock-account:user1'));

    await testInstallProgram(engine);
    await testInstallProgramHighLevel(engine);

    await testHandleInstallNoPermissionNoAssistant(engine);
    await testHandleInstallNoPermission(engine);
    await testHandleInstallNoPermissionSMT(engine);
    await testHandleInstallInvalidIdentity(engine);
    await testHandleInstallTypeError(engine);
    await testHandleInstallOk(engine);
    await testHandleInstallOkPermission(engine);
    await testHandleInstallOkGet(engine);
};
