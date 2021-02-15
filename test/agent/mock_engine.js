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
import { Ast, Compiler, SchemaRetriever } from 'thingtalk';
import Gettext from 'node-gettext';
import * as uuid from 'uuid';
import AsyncQueue from 'consumer-queue';

import { getProgramName } from '../../lib/utils/thingtalk/describe';
import { MockPlatform } from '../unit/mock_utils';
import {
    ResultGenerator,
    SimulationExecEnvironment,
} from '../../lib/dialogue-agent/simulator/simulation_exec_environment';


class QueueOutputDelegate {
    constructor() {
        this._queue = new AsyncQueue();
    }

    [Symbol.asyncIterator]() {
        return this;
    }
    next() {
        return this._queue.pop();
    }

    done() {
        this._queue.push({ done: true });
    }
    output(outputType, outputValue) {
        this._queue.push({ done: false, value: { outputType, outputValue } });
    }
    notifyError(error) {
        this._queue.push({ done: false, value: error });
    }
}

class MockAppExecutor {
    constructor(simulator, schemas, program, options) {
        this._simulator = simulator;
        this._schemas = schemas;
        this._rng = options.rng;

        this.name = options.name;
        this.description = options.description;
        this.code = program.prettyprint();
        this.state = options;
        this.uniqueId = options.uniqueId;

        console.log('MOCK: App ' + options.name + ' with code ' + this.code + ' loaded');

        this._program = program;
        assert(this._program.statements.length === 1);
        this.mainOutput = new QueueOutputDelegate();
    }

    async compile() {
        const compiler = new Compiler(this._schemas);
        this._compiled = await compiler.compileCode(this.code);
    }

    async execute() {
        const overrides = new Map;
        const generator = new ResultGenerator(this._rng, overrides);
        for (let slot of this._program.iterateSlots2()) {
            if (slot instanceof Ast.DeviceSelector)
                continue;
            generator.addCandidate(slot.get());
        }
        this._simulator.generator = generator;
        this._simulator.output = async (outputType, outputValue) => {
            return this.mainOutput.output(outputType, outputValue);
        };
        this._simulator.reportError = async (msg, err) => {
            return this.mainOutput.notifyError(err);
        };
        await this._compiled.command(this._simulator);
        this.mainOutput.done();
    }
}

class MockAppDatabase {
    constructor(schemas, gettext, rng, database) {
        this._apps = {};
        this._schemas = schemas;
        this._gettext = gettext;
        this._rng = rng;
        assert(rng);
        this._database = database;
        this._simulator = new SimulationExecEnvironment('en-US', 'America/Los_Angeles', this._schemas, this._database, {
            rng, simulateErrors: false
        });

        this._apps['app-foo'] = { name: 'Execute Foo',
            description: 'This app fooes', code: 'now => @builtin.foo();', state: {},
            uniqueId: 'app-foo', isRunning: true };
        this._apps['uuid-test-notify2'] = {
            name: 'Xkcd ⇒ Notification',
            description: 'get xkcd and stuff',
            uniqueId: 'uuid-test-notify2',
            isRunning: true
        };
    }

    getApp(appId) {
        return this._apps[appId];
    }

    async createApp(program, options) {
        if (!options.uniqueId)
            options.uniqueId = uuid.v4();
        if (!options.name)
            options.name = getProgramName(program);
        options.rng = this._rng;
        const app = new MockAppExecutor(this._simulator, this._schemas, program, options);
        this._apps[options.uniqueId] = app;
        await app.compile();

        // execute asynchronously
        app.execute();
        return app;
    }
}

class MockTwitterDevice {
    constructor(who) {
        this.name = "Twitter Account " + who;
        this.kind = 'com.twitter';
        this.uniqueId = 'twitter-' + who;
    }
}

class MockYoutubeDevice {
    constructor(who) {
        this.name = "Youtube Account " + who;
        this.kind = 'com.youtube';
        this.uniqueId = 'youtube-' + who;
    }
}

class MockBingQuery {
    constructor() {
        this.uniqueId = 'com.bing-web_search';
    }

    formatEvent(event) {
        return { type: 'rdl', displayTitle: event[0], displayText: event[1],
            webCallback: event[2], callback: event[2] };
    }

    invokeQuery() {
        return Promise.resolve([
            ['Google', "Google is where you should really run your searches", 'http://google.com'],
            ['Bing', "Bing is what you're using. So dumb it's not even first!", 'http://bing.com'],
            ['Yahoo', "If all else fails", 'http://yahoo.com']
        ]);
    }

    close() {
    }
}

class MockBingDevice {
    constructor() {
        this.name = "Bing Search";
        this.description = "I know you secretly want to bing your hot friend.";
        this.kind = 'com.bing';
        this.uniqueId = 'com.bing';
    }

    getQuery(id) {
        if (id !== 'web_search')
            throw new Error('Unexpected id in MOCK Bing: ' + id);
        return Promise.resolve(new MockBingQuery());
    }
}

class MockPhoneDevice {
    constructor() {
        this.name = "Phone";
        this.description = "Your phone, in your hand. Not that hand, the other one.";
        this.kind = 'org.thingpedia.builtin.thingengine.phone';
        this.uniqueId = 'org.thingpedia.builtin.thingengine.phone';
    }
}

class MockBuiltinDevice {
    constructor() {
        this.name = "Builtin";
        this.description = "Time random bla bla bla";
        this.kind = 'org.thingpedia.builtin.thingengine.builtin';
        this.uniqueId = 'thingengine-own-global';
    }
}

let _cnt = 0;

const UNIQUE_DEVICES = new Set(['com.yelp', 'org.thingpedia.weather']);
class MockUnknownDevice {
    constructor(kind) {
        if (UNIQUE_DEVICES.has(kind)) {
            this.name = "Some Device " + kind;
            this.description = 'This is a device of some sort';
            this.kind = kind;
            this.uniqueId = kind;
        } else {
            let id = ++_cnt;

            this.name = "Some Device " + id;
            this.description = 'This is a device of some sort';
            this.kind = kind;
            this.uniqueId = kind + '-' + id;
        }
    }
}

class MockLightbulb {
    constructor(uniqueId, name) {
        this.name = name;
        this.description = "Lights in the " + name;
        this.kind = 'light-bulb';
        this.uniqueId = 'light-bulb-' + uniqueId;
    }
}

class MockDeviceDatabase {
    constructor() {
        this._devices = {};
        this._devices['twitter-foo'] = new MockTwitterDevice('foo');
        this._devices['twitter-bar'] = new MockTwitterDevice('bar');
        this._devices['youtube-foo'] = new MockYoutubeDevice('foo');
        this._devices['security-camera-foo'] = new MockUnknownDevice('security-camera');
        this._devices['security-camera-bar'] = new MockUnknownDevice('security-camera');
        this._devices['instagram-1'] = new MockUnknownDevice('instagram');

        this._devices['light-bulb-bed1'] = new MockLightbulb('bed1', 'Bed Light 1');
        this._devices['light-bulb-bed2'] = new MockLightbulb('bed2', 'Bed Light 2');
        this._devices['light-bulb-kitchen'] = new MockLightbulb('kitchen', 'Kitchen Lights');
        this._devices['light-bulb-ceiling'] = new MockLightbulb('ceiling', 'Ceiling Lights');
        // increase cnt so the tests don't fail
        _cnt++;

        this._devices['org.thingpedia.builtin.thingengine.phone'] = new MockPhoneDevice();
        this._devices['thingengine-own-global'] = new MockBuiltinDevice();
        this._devices['org.thingpedia.builtin.thingengine.remote'] = new MockUnknownDevice('remote');
    }

    addSerialized(blob) {
        if (blob.kind === 'com.bing') {
            console.log('MOCK: Loading bing');
            return Promise.resolve(this._devices['com.bing'] = new MockBingDevice());
        } else {
            console.log('MOCK: Loading device ' + JSON.stringify(blob));
            const device = new MockUnknownDevice(blob.kind);
            return Promise.resolve(this._devices[device.uniqueId] = device);
        }
    }

    async addInteractively(kind, delegate) {
        return new MockUnknownDevice(kind);
    }

    async completeDiscovery(instance, delegate) {
        await instance.completeDiscovery(delegate);
        this._devices[instance.uniqueId] = instance;
        return instance;
    }

    hasDevice(id) {
        return id in this._devices;
    }

    getDevice(id) {
        return this._devices[id];
    }

    getAllDevices(kind) {
        if (kind)
            return this.getAllDevicesOfKind(kind);
        return Object.keys(this._devices).map((k) => { return this._devices[k]; });
    }

    getAllDevicesOfKind(kind) {
        return this.getAllDevices().filter((d) => { return d.kind === kind; });
    }
}

const MOCK_ADDRESS_BOOK_DATA = [
    { displayName: 'Mom Corp Inc.', alternativeDisplayName: 'Mom Corp Inc.',
      isPrimary: true, starred: false, timesContacted: 0, type: 'work',
      email_address: 'momcorp@momcorp.com', phone_number: '+1800666' /* 1-800-MOM (not a satanic reference :P ) */ },
    { displayName: 'Mom Corp Inc.', alternativeDisplayName: 'Mom Corp Inc.',
      isPrimary: false, starred: false, timesContacted: 0, type: 'work',
      email_address: 'support@momcorp.com', phone_number: '+18006664357' /* 1-800-MOM-HELP */ },
    { displayName: 'Alice Smith (mom)', alternativeDisplayName: 'Smith, Alice',
      isPrimary: true, starred: true, timesContacted: 10000, type: 'mobile',
      email_address: 'alice@smith.com', phone_number: '+5556664357' },
    { displayName: 'Bob Smith (dad)', alternativeDisplayName: 'Smith, Bob',
      isPrimary: true, starred: true, timesContacted: 10000, type: 'mobile',
      email_address: 'bob@smith.com', phone_number: '+555123456' },
    { displayName: 'Carol Johnson', alternativeDisplayName: 'Johnson, Carol',
      isPrimary: true, starred: false, timesContacted: 10, type: 'home',
      email_address: 'carol@johnson.com', phone_number: '+555654321' },
    { displayName: 'Alice Johnson', alternativeDisplayName: 'Johnson, Alice',
      isPrimary: true, starred: false, timesContacted: 10, type: 'work',
      email_address: 'alice@johnson.com', phone_number: '+555654322' },
];

class MockAddressBook {
    lookup(item, key) {
        if (key === 'missing_user')
            return Promise.resolve([]);
        let data;
        if (key === 'invalid_user') {
            data = [{ displayName: 'Invalid User', alternativeDisplayName: 'User, Invalid',
                      isPrimary: true, starred: false, timesContacted: 10, type: 'work',
                      email_address: 'invalid@example.com', phone_number: '+XXXXXXXXX' }];
        } else {
            data = MOCK_ADDRESS_BOOK_DATA;
        }

        return Promise.resolve(data.map((el) => {
            if (item === 'contact')
                el.value = 'phone:' + el.phone_number;
            else
                el.value = el[item];
            return el;
        }));
    }

    lookupPrincipal(principal) {
        return Promise.resolve(MOCK_ADDRESS_BOOK_DATA.find((contact) => {
            if (principal.startsWith('phone:'))
                return contact.phone_number === principal.substr('phone:'.length);
            if (principal.startsWith('email:'))
                return contact.email_address === principal.substr('email:'.length);
            return null;
        }) || null);
    }
}

const _gpsApi = {
    async getCurrentLocation() {
        // at stanford, on the ground, facing north, standing still
        return {
            latitude: 37.4275,
            longitude: -122.1697,
            altitude: 29,
            bearing: 0,
            speed: 0
        };
    }
};

class TestPlatform extends MockPlatform {
    constructor() {
        super();
        this.disableGPS = false;
        this._gettext = new Gettext();
        this._gettext.setLocale('en-US');
    }

    hasCapability(cap) {
        return cap === 'gettext' || cap === 'contacts' || cap === 'gps';
    }

    getCapability(cap) {
        switch (cap) {
        case 'gettext':
            return this._gettext;
        case 'contacts':
            return new MockAddressBook();
        case 'gps':
            if (!this.disableGPS)
                return _gpsApi;
        default:
            return null;
        }
    }
}

function toDeviceInfo(d) {
    const deviceKlass = 'physical';
    return {
        uniqueId: d.uniqueId,
        name: d.name,
        description: d.description,
        kind: d.kind,
        version: 0,
        class: deviceKlass,
        ownerTier: d.ownerTier,
        isTransient: d.isTransient
    };
}

export function createMockEngine(thingpedia, rng, database) {
    const platform = new TestPlatform();
    const schemas = new SchemaRetriever(thingpedia, null, true);

    let gettext = platform.getCapability('gettext');
    const engine = {
        platform: platform,
        thingpedia: thingpedia,
        schemas: schemas,
        devices: new MockDeviceDatabase(),
        apps: new MockAppDatabase(schemas, gettext, rng, database),

        createApp(program, options = {}) {
            return this.apps.createApp(program, options);
        },

        getDeviceInfos(kind) {
            const devices = this.devices.getAllDevices(kind);
            return devices.map((d) => toDeviceInfo(d));
        },

        getDeviceInfo(uniqueId) {
            return toDeviceInfo(this.devices.getDevice(uniqueId));
        },

        createDevice(blob) {
            return this.devices.addSerialized(blob);
        }
    };
    engine.gettext = function(string) {
        return gettext.dgettext('genie-toolkit', string);
    };
    engine.ngettext = function(msg, msgplural, count) {
        return gettext.dngettext('genie-toolkit', msg, msgplural, count);
    };
    engine.pgettext = function(msgctx, msg) {
        return gettext.dpgettext('genie-toolkit', msgctx, msg);
    };
    engine._ = engine.gettext;

    return engine;
}
