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
import * as Tp from 'thingpedia';
import { Ast, Compiler, SchemaRetriever } from 'thingtalk';
import Gettext from 'node-gettext';
import * as uuid from 'uuid';
import * as events from 'events';
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
        this._n = 0;
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
        this._n++;
        this._queue.push({ done: false, value: { outputType, outputValue } });
    }
    error(error) {
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
        const generator = new ResultGenerator(this._rng, 'America/Los_Angeles', overrides);
        for (let slot of this._program.iterateSlots2()) {
            if (slot instanceof Ast.DeviceSelector)
                continue;
            generator.addCandidate(slot.get());
        }
        this._simulator.generator = generator;
        this._simulator.setOutputDelegate(this.mainOutput);
        if (this._compiled.command)
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

        // execute synchronously (we'll push to the queue)
        await app.execute();
        return app;
    }
}

class MockDevice {
    hasKind(kind) {
        return kind === this.kind;
    }

    queryInterface() {
        return null;
    }

    serialize() {
        return { kind: this.kind };
    }
}

class MockTwitterDevice extends MockDevice {
    constructor(who) {
        super();
        this.name = "Twitter Account " + who;
        this.kind = 'com.twitter';
        this.uniqueId = 'twitter-' + who;
    }
}

class MockYoutubeDevice extends MockDevice {
    constructor(who) {
        super();
        this.name = "Youtube Account " + who;
        this.kind = 'com.youtube';
        this.uniqueId = 'youtube-' + who;
    }
}

class MockBingDialogueHandler {
    icon = 'com.bing';

    initialize() {
        return null;
    }

    getState() {
        return '';
    }

    reset() {
    }

    analyzeCommand(command) {
        if (command === '!! test command always bing !!') {
            return {
                confident : Tp.DialogueHandler.Confidence.CONFIDENT_IN_DOMAIN_COMMAND,
                utterance : command,
                user_target : '$dialogue @com.bing.search;',
                my_prop : 42
            };
        }

        return {
            confident : Tp.DialogueHandler.Confidence.OUT_OF_DOMAIN_COMMAND,
            utterance : command,
            user_target : '',
        };
    }

    getReply(analysis) {
        assert.strictEqual(analysis.utterance, '!! test command always bing !!');
        assert.strictEqual(analysis.my_prop, 42);

        return {
            messages: [
                'Here is something I found on the web.',
                {
                    type: 'rdl',
                    webCallback: 'http://example.com',
                    callback: 'http://example.com',
                    displayTitle: 'Example 1'
                }, {
                    type: 'rdl',
                    webCallback: 'http://example.org',
                    callback: 'http://example.org',
                    displayTitle: 'Example 2'
                }
            ],

            expecting: null,
            context: '$dialogue @com.bing.search;',
            agent_target: '$dialogue @com.bing.sys_search_result;'
        };
    }
}

class MockBingDevice extends MockDevice {
    constructor() {
        super();
        this.name = "Bing Search";
        this.description = "I know you secretly want to bing your hot friend.";
        this.kind = 'com.bing';
        this.uniqueId = 'com.bing';
        this.icon = 'com.bing';
    }

    hasKind(kind) {
        return kind === 'com.bing' || kind === 'org.thingpedia.dialogue-handler';
    }

    queryInterface(iface) {
        if (iface === 'dialogue-handler')
            return new MockBingDialogueHandler();
        return null;
    }
}

class MockPhoneDevice extends MockDevice {
    constructor() {
        super();
        this.name = "Phone";
        this.description = "Your phone, in your hand. Not that hand, the other one.";
        this.kind = 'org.thingpedia.builtin.thingengine.phone';
        this.uniqueId = 'org.thingpedia.builtin.thingengine.phone';
    }
}

class MockBuiltinDevice extends MockDevice {
    constructor() {
        super();
        this.name = "Builtin";
        this.description = "Time random bla bla bla";
        this.kind = 'org.thingpedia.builtin.thingengine.builtin';
        this.uniqueId = 'org.thingpedia.builtin.thingengine.builtin';
    }
}

let _cnt = 0;

const UNIQUE_DEVICES = new Set(['com.yelp', 'org.thingpedia.weather', 'org.thingpedia.builtin.test', 'com.thecatapi', 'com.xkcd']);
class MockUnknownDevice extends MockDevice {
    constructor(kind) {
        super();
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

class MockSwitch extends MockDevice {
    constructor(uniqueId, name) {
        super();
        this.name = name;
        this.description = "Switch in the " + name;
        this.kind = 'org.thingpedia.iot.switch';
        this.uniqueId = 'switch-' + uniqueId;
    }
}

class MockDeviceDatabase extends events.EventEmitter {
    constructor() {
        super();
        this._devices = {};
        this._devices['com.bing'] = new MockBingDevice();
        this._devices['twitter-foo'] = new MockTwitterDevice('foo');
        this._devices['twitter-bar'] = new MockTwitterDevice('bar');
        this._devices['youtube-foo'] = new MockYoutubeDevice('foo');
        this._devices['security-camera-foo'] = new MockUnknownDevice('security-camera');
        this._devices['security-camera-bar'] = new MockUnknownDevice('security-camera');
        this._devices['instagram-1'] = new MockUnknownDevice('instagram');

        this._devices['switch-bed1'] = new MockSwitch('bed1', 'Bed Switch 1');
        this._devices['switch-bed2'] = new MockSwitch('bed2', 'Bed Switch 2');
        this._devices['switch-kitchen'] = new MockSwitch('kitchen', 'Kitchen Switches');
        this._devices['switch-ceiling'] = new MockSwitch('ceiling', 'Ceiling Switches');
        this._devices['switch-office-de'] = new MockSwitch('office-de', 'Büro Decke');
        // increase cnt so the tests don't fail
        _cnt++;

        this._devices['org.thingpedia.builtin.thingengine.phone'] = new MockPhoneDevice();
        this._devices['org.thingpedia.builtin.thingengine.builtin'] = new MockBuiltinDevice();
        this._devices['org.thingpedia.builtin.thingengine.remote'] = new MockUnknownDevice('remote');
    }

    values() {
        return this.getAllDevices();
    }

    addSerialized(blob) {
        if (blob.kind === 'com.bing') {
            console.log('MOCK: Loading bing');
            this._devices['com.bing'] = new MockBingDevice();
            this.emit('device-added', this._devices['com.bing']);
            return Promise.resolve();
        } else {
            console.log('MOCK: Loading device ' + JSON.stringify(blob));
            const device = new MockUnknownDevice(blob.kind);
            this.emit('device-added', device);
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
        return Object.keys(this._devices).map((k) => {
            return this._devices[k];
        });
    }

    getAllDevicesOfKind(kind) {
        return this.getAllDevices().filter((d) => {
            return d.kind === kind;
        });
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

class MockAudioController {
    async stopAudio() {}
}

class MockAssistantDispatcher {
    getAvailableNotificationBackends() {
        return [{ name: 'SMS', uniqueId: 'twilio', requiredSettings:['$context.self.phone_number'] }];
    }
}

class MockLocalTable {
    constructor(name) {
        this.name = name;
        this._db = {};
    }

    getAll() {
        return new Promise((resolve) => {
            resolve(Object.values(this._db));
        });
    }

    getBy(field, value) {
        return this.getAll().then((rows) => rows.filter((row) => row[field] === value));
    }

    search() {
        return this.getAll();
    }

    getOne(uniqueId) {
        return new Promise((resolve) => {
            resolve(this._db[uniqueId]);
        });
    }

    insertOne(uniqueId, row) {
        return new Promise((resolve) => {
            this._db[uniqueId] = { uniqueId: uniqueId, ...row };
            resolve();
        });
    }

    deleteOne(uniqueId) {
        return new Promise((resolve, reject) => {
            if (uniqueId in this._db) {
                delete this._db[uniqueId];
                resolve();
            } else {
                reject(Error(`LocalTable ${this.name}: ${uniqueId} not found`));
            }
        });
    }
}

class MockAbstractDatabase {
    constructor() {
        this._localTables = {};
    }

    getLocalTable(name) {
        if (name in this._localTables) {
            return this._localTables[name];
        } else {
            const table = new MockLocalTable(name);
            this._localTables[name] = table;
            return table;
        }
    }
}

class MockActivityMonitor extends events.EventEmitter {}

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
        audio: new MockAudioController(),
        assistant: new MockAssistantDispatcher(),
        db : new MockAbstractDatabase(),
        activityMonitor : new MockActivityMonitor(),

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
        },

        updateActivity() {}
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
