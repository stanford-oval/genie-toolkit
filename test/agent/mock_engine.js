// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Tp = require('thingpedia');
const Gettext = require('node-gettext');
const uuid = require('uuid');

const { MockPlatform } = require('../unit/mock_utils');

class MockAppExecutor {
    constructor(schemas, code, options) {
        this._schemas = schemas;

        this.name = options.name;
        this.description = options.description;
        this.code = code;
        this.state = options;
        this.uniqueId = options.uniqueId;

        console.log('MOCK: App ' + options.name + ' with code ' + code + ' loaded');

        // TODO: put some real outputs here for testing
        this.mainOutput = [];
    }

    async compile() {
        const compiler = new ThingTalk.Compiler(this._schemas);
        await compiler.compileCode(this.code);
    }
}

class MockAppDatabase {
    constructor(schemas, gettext) {
        this._apps = {};
        this._schemas = schemas;
        this._gettext = gettext;

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
        const code = program.prettyprint();
        if (!options.uniqueId)
            options.uniqueId = uuid.v4();
        if (!options.name)
            options.name = ThingTalk.Describe.getProgramName(this._gettext, program);
        const app = new MockAppExecutor(this._schemas, code, options);
        this._apps[options.uniqueId] = app;
        await app.compile();
        return app;
    }
}

class MockNineGagDevice {
    constructor() {
        this.name = "NineGag";
        this.kind = 'ninegag';
        this.uniqueId = '9gag';
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

class MockEmailDevice {
    constructor(who) {
        this.name = "Email Sender";
        this.kind = 'emailsender';
        this.uniqueId = 'emailsender';
    }
}

class MockBluetoothDevice {
    constructor(who, paired) {
        this.name = "Bluetooth Device " + who;
        this.description = 'This is a bluetooth device of some sort';
        this.kind = 'mock.bluetooth';
        this.uniqueId = 'mock.bluetooth-' + who;
        this.discoveredBy = 'phone';
        this.paired = paired;
    }

    completeDiscovery(delegate) {
        if (this.paired) {
            delegate.configDone();
            return Promise.resolve();
        }

        console.log('MOCK: Pairing with ' + this.uniqueId);
        return delegate.confirm('Do you confirm the code 123456?').then((res) => {
            if (!res) {
                delegate.configFailed(new Error('Cancelled'));
                return;
            }

            console.log('MOCK: Pairing done');
            this.paired = true;
            delegate.configDone();
        });
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

var _cnt = 0;

class MockUnknownDevice {
    constructor(kind) {
        var id = ++_cnt;

        this.name = "Some Device " + id;
        this.description = 'This is a device of some sort';
        this.kind = kind;
        this.uniqueId = kind + '-' + id;
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
        this._devices['9gag'] = new MockNineGagDevice();
        this._devices['emailsender'] = new MockEmailDevice();
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

    getAllDevices() {
        return Object.keys(this._devices).map((k) => { return this._devices[k]; });
    }

    getAllDevicesOfKind(kind) {
        return this.getAllDevices().filter((d) => { return d.kind === kind; });
    }
}

class MockDiscoveryClient {
    runDiscovery(_timeout, type) {
        if (type === 'bluetooth' || !type)
            return Promise.resolve([new MockBluetoothDevice('foo', true), new MockBluetoothDevice('bar', false)]);
        else
            return Promise.resolve([]);
    }

    stopDiscovery() {
        return Promise.resolve();
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

class MockMessagingManager {
    constructor() {
        this.isAvailable = true;
        this.type = 'mock';
        this.account = 'mock-account:123456-SELF';
    }

    getSelf() {
        return this.account;
    }

    isSelf(principal) {
        return principal === this.account;
    }

    getIdentities() {
        return ['phone:+15555555555'];
    }

    getUserByAccount(account) {
        if (account === 'mock-account:123456789')
            return Promise.resolve({ name: "Some Guy" });
        else
            return Promise.resolve(null);
    }

    getAccountForIdentity(identity) {
        if (identity === 'phone:+XXXXXXXXX')
            return Promise.resolve(null);
        return Promise.resolve('mock-account:MOCK1234-' + identity);
    }
}

class MockRemote {
    constructor(schemas) {
        this._schemas = schemas;
    }


    installProgramRemote(principal, identity, uniqueId, program) {
        console.log('MOCK: Sending rule to ' + principal + ': ' + program.prettyprint());
        return Promise.resolve();
    }
}

class MockPermissionManager {
    constructor(schemas) {
        this._Schemas = schemas;
    }

    addPermission(permissionRule, extra) {
        console.log('Added permission rule ' + permissionRule.prettyprint());
        return Promise.resolve();
    }

    checkCanBeAllowed(principal, program) {
        if (program.prettyprint(true) === `now => @com.facebook.post(status="MOCK DISALLOWED PROGRAM");`)
            return Promise.resolve(false);

        return Promise.resolve(true);
    }

    checkIsAllowed(principal, program) {
        if (program.prettyprint(true) === `now => @com.facebook(id="com.facebook-33").post(status="MOCK DISALLOWED PROGRAM");`)
            return Promise.resolve(null);

        return Promise.resolve(program);
    }
}

const THINGPEDIA_URL = process.env.THINGPEDIA_URL || 'https://almond-dev.stanford.edu/thingpedia';

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

    getCacheDir() {
        return './cache';
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

module.exports.createMockEngine = function(thingpediaUrl) {
    const platform = new TestPlatform();
    var thingpedia;
    if (typeof thingpediaUrl === 'string')
        thingpedia = new Tp.HttpClient(platform, thingpediaUrl || THINGPEDIA_URL);
    else
        thingpedia = thingpediaUrl;
    var schemas = new ThingTalk.SchemaRetriever(thingpedia, null, true);

    let gettext = platform.getCapability('gettext');
    const engine = {
        platform: platform,
        thingpedia: thingpedia,
        schemas: schemas,
        devices: new MockDeviceDatabase(),
        apps: new MockAppDatabase(schemas, gettext),
        discovery: new MockDiscoveryClient(),
        messaging: new MockMessagingManager(),
        remote: new MockRemote(schemas),
        permissions: new MockPermissionManager(schemas),

        createApp(program, options = {}) {
            return this.apps.createApp(program, options);
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
    engine._ = this.gettext;

    return engine;
};
