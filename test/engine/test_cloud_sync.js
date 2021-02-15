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

const TEST_CLOUD_ID = '517e033d9b977261';
const TEST_AUTH_TOKEN = '7f4b4735717bd8e400625e97557902dbce4c0b1c86c811eb49d558fec57c4eca';

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export default async function testCloudSync(engine) {
    const platform = engine.platform;
    const prefs = platform.getSharedPreferences(platform);

    const tierManager = engine._tiers;

    assert.strictEqual(tierManager.ownTier, 'desktop');
    assert.strictEqual(tierManager.ownIdentity.length, 17);
    assert(tierManager.ownAddress.startsWith('desktop:'));

    const self = engine.devices.getDevice('thingengine-own-' + tierManager.ownAddress);
    assert(self);

    assert.strictEqual(self.tier, 'desktop');
    assert.strictEqual(self.identity, tierManager.ownIdentity);
    assert.strictEqual(self.address, tierManager.ownAddress);

    assert.strictEqual(prefs.get('cloud-id'), undefined);
    assert(!tierManager.isConnected('cloud'));

    engine.setCloudId(TEST_CLOUD_ID, TEST_AUTH_TOKEN);
    assert(tierManager.isConnected('cloud'));

    // wait 10 seconds to sync...
    await delay(10000);

    const cloud = engine.devices.getDevice('thingengine-own-cloud');
    assert(cloud);

    assert.strictEqual(cloud.tier, 'cloud');
    assert.strictEqual(cloud.identity, '');
    assert.strictEqual(cloud.address, 'cloud');
    assert.strictEqual(cloud.cloudId, TEST_CLOUD_ID);

    // this user has no developer key, because I am not 100% comfortable with putting
    // the credentials to a developer user online
    assert.strictEqual(cloud.developerKey, null);

    // note: here we would like to call /me/api/devices/list and check that thingengine-own-desktop:...
    // has been added to the remote list of devices
    // but we can't do that until almond-dev has been updated with this version of the thingengine-core

    assert(tierManager.isConnected('cloud'));
    await engine.devices.removeDevice(cloud);

    // sync has been broken
    assert.strictEqual(prefs.get('cloud-id'), undefined);
    await delay(5000);
    assert(!tierManager.isConnected('cloud'));
}
