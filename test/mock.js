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

const ThingpediaClient = require('./http_client');
const _mockThingpediaClient = require('./mock_schema_delegate');

class MockPreferences {
    constructor() {
        this._store = {};

        // change this line to test the initialization dialog
        this._store['sabrina-initialized'] = true;
        this._store['sabrina-name'] = "Alice Tester";
    }

    get(name) {
        return this._store[name];
    }

    set(name, value) {
        console.log(`preferences set ${name} = ${value}`);
        this._store[name] = value;
    }
}

class MockStatistics {
    constructor() {
        this._store = {};
    }

    snapshot() {
        console.log('Statistics snapshot');
    }

    keys() {
        return Object.keys(this._store);
    }

    set(key, value) {
        return this._store[key] = value;
    }

    get(key) {
        return this._store[key];
    }

    hit(key) {
        var old = this._store[key];
        if (old === undefined)
            old = 0;
        this._store[key] = old+1;
    }
}

class MockAppDatabase {
    constructor(schemas) {
        this._apps = {};
        this._schemas = schemas;

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

    loadOneApp(code, state, uniqueId, tier, name, description, addToDB) {
        console.log('MOCK: App ' + name + ' with code ' + code + ' loaded and state ' + JSON.stringify(state));
        this._apps[uniqueId] = { name: name, description: description, code: code, state: state, uniqueId: uniqueId };
        var compiler = new ThingTalk.Compiler();
        compiler.setSchemaRetriever(this._schemas);
        return compiler.compileCode(code).then(() => {
            return {
                mainOutput: {
                    next() {
                        return { done: true };
                    }
                }
            };
        });
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

    get_get_gps() {
        return Promise.resolve([{
            location: { y: 37.4275, x: -122.1697 },
            altitude: 29,
            bearing: 0,
            speed: 0
        }]); // at stanford, on the ground, facing north, standing still
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
        this._devices['light-bulb-1'] = new MockUnknownDevice('light-bulb');
        this._devices['org.thingpedia.builtin.thingengine.phone'] = new MockPhoneDevice();
        this._devices['thingengine-own-global'] = new MockBuiltinDevice();
        this._devices['org.thingpedia.builtin.thingengine.remote'] = new MockUnknownDevice('remote');
    }

    loadOneDevice(blob, save) {
        if (blob.kind === 'com.bing') {
            console.log('MOCK: Loading bing');
            return Promise.resolve(this._devices['com.bing'] = new MockBingDevice());
        } else {
            console.log('MOCK: Loading device ' + JSON.stringify(blob));
            return Promise.resolve(new MockUnknownDevice(blob.kind));
        }
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
        return Promise.resolve(MOCK_ADDRESS_BOOK_DATA.map((el) => {
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

class MockMessaging {
    constructor() {
        this.isAvailable = true;
        this.type = 'mock';
        this.account = '123456-SELF';
    }

    getIdentities() {
        return ['phone:+15555555555'];
    }

    getUserByAccount(account) {
        if (account === '123456789')
            return Promise.resolve({ name: "Some Guy" });
        else
            return Promise.resolve(null);
    }

    getAccountForIdentity(identity) {
        return Promise.resolve('MOCK1234-' + identity);
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

    checkIsAllowed(principal, program) {
        return Promise.resolve(program);
    }
}

var Gettext = require('node-gettext');
var _gettext = new Gettext();
_gettext.setLocale('en_US.utf8');

const THINGPEDIA_URL = process.env.THINGPEDIA_URL || 'https://crowdie.stanford.edu/thingpedia';

module.exports.createMockEngine = function(thingpediaUrl) {
    var thingpedia;
    if (thingpediaUrl === 'mock')
        thingpedia = _mockThingpediaClient;
    else
        thingpedia = new ThingpediaClient(thingpediaUrl || THINGPEDIA_URL, null);
    var schemas = new ThingTalk.SchemaRetriever(thingpedia, null, true);

    return {
        platform: {
            _prefs: new MockPreferences(),

            getSharedPreferences() {
                return this._prefs;
            },

            locale: 'en-US',
            //locale: 'it',
            type: 'test',

            hasCapability(cap) {
                return cap === 'gettext' || cap === 'contacts';
            },

            getCapability(cap) {
                if (cap === 'gettext')
                    return _gettext;
                else if (cap === 'contacts')
                    return new MockAddressBook();
                else
                    return null;
            }
        },
        stats: new MockStatistics,
        thingpedia: thingpedia,
        schemas: schemas,
        devices: new MockDeviceDatabase(),
        apps: new MockAppDatabase(schemas),
        discovery: new MockDiscoveryClient(),
        messaging: new MockMessaging(),
        remote: new MockRemote(schemas),
        permissions: new MockPermissionManager(schemas)
    };
};