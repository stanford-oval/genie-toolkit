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

const TEST_HOMESERVER = 'camembert.stanford.edu';

process.env.MATRIX_IDENTITY_SERVER_URL = `http://${TEST_HOMESERVER}:8090`;
process.env.MATRIX_HOMESERVER_URL = `http://${TEST_HOMESERVER}:8008`;

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function testMockMessaging(messaging) {
    assert(messaging.isSelf('mock-account:user1'));
    assert(!messaging.isSelf('mock-account:user2'));
    assert(!messaging.isSelf('invalid:user1'));
    assert(!messaging.isSelf('user1'));

    assert.strictEqual(messaging.getSelf(), 'mock-account:user1');
    assert.strictEqual(messaging.getSelf('mock-account:user2'), 'mock-account:user1');

    assert.throws(() => messaging.getSelf('other-account:user2'), /^Error: Invalid messaging type other$/g);

    assert.deepStrictEqual(messaging.getIdentities(), ['phone:+1555123456', 'email:bob@example.com']);
}

async function testLoginAsMatrixUser(engine) {
    const delegate = {
        reply(msg) {
            console.log('>> ' + msg);
        },
        confirm(question) {
            console.log('>? ' + question);
            return Promise.resolve(true);
        },
        configDone() {
        },
        configFailed(error) {
            throw error;
        },
        requestCode(question) {
            console.log('>= ' + question);

            switch (question) {
            case "Insert your email address or phone number:":
                return Promise.resolve(`testuser1@${TEST_HOMESERVER}`);
            case "Insert your password:":
                return Promise.resolve(`testuser1`);
            default:
                throw new Error('Unexpected question');
            }
        }
    };

    await engine.devices.addInteractively('org.thingpedia.builtin.matrix', delegate);
    // wait a for full sync
    await delay(10000);
}

async function testMatrix(engine) {
    const device = engine.devices.getDevice(`org.thingpedia.builtin.matrix-@testuser1:${TEST_HOMESERVER}`);

    assert(device);
    assert.deepStrictEqual(device.userId, `@testuser1:${TEST_HOMESERVER}`);
    assert.deepStrictEqual(device.identities, [
        `email:testuser1@${TEST_HOMESERVER}`,
        `matrix-account:@testuser1:${TEST_HOMESERVER}`
    ]);

    const messaging = device.queryInterface('messaging');
    assert(messaging);

    assert.deepStrictEqual(messaging.type, 'matrix');
    assert.deepStrictEqual(messaging.account, `matrix-account:@testuser1:${TEST_HOMESERVER}`);
}

async function testMessagingWithMatrix(engine) {
    const messaging = engine.messaging;

    assert(messaging.isSelf('mock-account:user1'));
    assert(messaging.isSelf(`matrix-account:@testuser1:${TEST_HOMESERVER}`));
    assert(!messaging.isSelf('mock-account:user2'));
    assert(!messaging.isSelf('invalid:user1'));
    assert(!messaging.isSelf('user1'));

    assert.strictEqual(messaging.getSelf(), 'mock-account:user1');
    assert.strictEqual(messaging.getSelf('mock-account:user2'), 'mock-account:user1');
    assert.strictEqual(messaging.getSelf(`matrix-account:@testuser2:${TEST_HOMESERVER}`), `matrix-account:@testuser1:${TEST_HOMESERVER}`);
    assert.strictEqual(messaging.getSelf(`matrix-account:@gcampax@matrix.org`), `matrix-account:@testuser1:${TEST_HOMESERVER}`);
    assert.strictEqual(messaging.getSelf([`matrix-account:@gcampax@matrix.org`, `matrix-account:@testuser2:${TEST_HOMESERVER}`]),
        `matrix-account:@testuser1:${TEST_HOMESERVER}`);

    assert.deepStrictEqual(messaging.getIdentities(), [
        'phone:+1555123456',
        'email:bob@example.com',
        `email:testuser1@${TEST_HOMESERVER}`,
        `matrix-account:@testuser1:${TEST_HOMESERVER}`
    ]);

    let foundMock = false, foundMatrix = false;
    for (let room of await messaging.getFeedList()) {
        if (room.feedId.startsWith('mock:')) {
            assert(room.feedId === 'mock:feed1' || room.feedId === 'mock:feed2');
            foundMock = true;
        } else if (room.feedId.startsWith('matrix:')) {
            assert(room.feedId.endsWith(`:${TEST_HOMESERVER}`));
            foundMatrix = true;

            //console.log('room ' + room.feedId);
            //console.log(room.getMembers());
        } else {
            assert.fail(`unexpected feed ${room.feedId}`);
        }
    }
    assert(foundMock && foundMatrix);

    const feed1 = messaging.getFeed('matrix:!EmyZpdhYPpXqnQugAk:camembert.stanford.edu');
    assert(feed1);
    // an object, not a promise (thenable)
    assert.strictEqual(typeof feed1.then, 'undefined');
    assert.deepStrictEqual(feed1.getMembers(), [
        'matrix-account:@testuser1:camembert.stanford.edu',
        'matrix-account:@testuser2:camembert.stanford.edu'
    ]);
    assert(messaging.getFeed('mock:feed1'));
    assert(messaging.getFeed('mock:feed2'));

    const feed2 = await messaging.getFeedByAlias('matrix:!EmyZpdhYPpXqnQugAk:camembert.stanford.edu');
    assert.strictEqual(feed2, feed1);

    const mockFeed1 = await messaging.getFeedWithContact('mock-account:user2');
    assert.strictEqual(mockFeed1.feedId, 'mock:feed1');

    const matrixFeed1 = await messaging.getFeedWithContact(['matrix-account:@testuser2:camembert.stanford.edu']);
    assert.strictEqual(matrixFeed1.feedId, 'matrix:!EmyZpdhYPpXqnQugAk:camembert.stanford.edu');

    const mixedFeed1 = await messaging.getFeedWithContact([
        'mock-account:user2',
        'matrix-account:@testuser2:camembert.stanford.edu'
    ]);
    assert.strictEqual(mixedFeed1.feedId, 'virtual:[mock%3Afeed1,matrix%3A!EmyZpdhYPpXqnQugAk%3Acamembert.stanford.edu]');
    assert.deepStrictEqual(mixedFeed1.getMembers(), [
        'mock-account:user1',
        'mock-account:user2',
        'matrix-account:@testuser1:camembert.stanford.edu',
        'matrix-account:@testuser2:camembert.stanford.edu'
    ]);

    const sentOnMock = new Promise((resolve, reject) => {
        engine.platform.getCapability('messaging').once('outgoing-message', (feedId, msg) => {
            try {
                assert.strictEqual(feedId, 'mock:feed1');
                assert.strictEqual(msg.sender, 'mock-account:user1');
                assert.strictEqual(msg.type, 'text');
                assert.strictEqual(msg.text, 'test message');
                resolve();
            } catch(e) {
                reject(e);
            }
        });
    });
    const sentOnMatrix = new Promise((resolve, reject) => {
        const device = engine.devices.getDevice(`org.thingpedia.builtin.matrix-@testuser1:${TEST_HOMESERVER}`);

        device.queryInterface('messaging').once('outgoing-message', (feedId, msg) => {
            try {
                assert.strictEqual(feedId, 'matrix:!EmyZpdhYPpXqnQugAk:camembert.stanford.edu');
                assert.strictEqual(msg.sender, `matrix-account:@testuser1:${TEST_HOMESERVER}`);
                assert.strictEqual(msg.type, 'text');
                assert.strictEqual(msg.text, 'test message');
                resolve();
            } catch(e) {
                reject(e);
            }
        });
    });

    await mixedFeed1.open();
    await mixedFeed1.sendText('test message');
    await mixedFeed1.close();

    await Promise.all([
        sentOnMock,
        sentOnMatrix
    ]);


    assert.strictEqual(await messaging.getAccountForIdentity('phone:+1555123456'), 'mock-account:user1');
    assert.strictEqual(await messaging.getAccountForIdentity(`email:testuser2@${TEST_HOMESERVER}`), `matrix-account:@testuser2:${TEST_HOMESERVER}`);
    assert.strictEqual(await messaging.getAccountForIdentity(`email:unknown@example.com`), null);

    assert.deepStrictEqual(await messaging.searchAccountByName('alice'), [await messaging.getUserByAccount('mock-account:user2')]);
}

async function cleanup(engine) {
    for (let d of engine.devices.getAllDevicesOfKind('messaging'))
        await engine.devices.removeDevice(d);
}

module.exports = async function testRemote(engine) {
    try {
        const messaging = engine.messaging;
        //const remote = engine.remote;
        assert(messaging.isAvailable);

        await testMockMessaging(messaging);

        await testLoginAsMatrixUser(engine);
        await testMatrix(engine);

        await testMessagingWithMatrix(engine);
    } finally {
        await cleanup(engine);
    }
};
