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
import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import ThingpediaDeviceFactories from './thingpedia-device-factories.json';

const _rssFactory = {
    "type":"form",
    "category":"online",
    "kind":"org.thingpedia.rss",
    "text":"RSS Feed",
    "fields":[{"name":"url","label":"Feed URL","type":"text"}]
};

export default class MockThingpediaClient extends Tp.BaseClient {
    constructor(testRunner) {
        super();
        this._testRunner = testRunner;
        this._devices = null;
        this._entities = null;

        const thisdir = path.dirname(module.filename);

        this._thingpediafilename = path.resolve(thisdir, 'thingpedia.tt');
        this._entityfilename = path.resolve(thisdir, 'entities.json');
        this._builtins = {};
        for (const builtin of ['thingengine.builtin', 'thingengine', 'test']) {
            this._builtins[builtin] = {
                manifest: path.resolve(thisdir, '../../data/builtins', builtin, 'manifest.tt'),
                dataset: path.resolve(thisdir, '../../data/builtins', builtin, 'dataset.tt'),
            };
        }
        this._loaded = null;
    }

    get developerKey() {
        return null;
    }
    get locale() {
        return 'en-US';
    }

    async getModuleLocation() {
        throw new Error(`Cannot download module using MockThingpediaClient`);
    }
    async getKindByDiscovery(id) {
        throw new Error(`Cannot perform device discovery using MockThingpediaClient`);
    }
    async clickExample(ex) {
        this._testRunner.writeLine('Clicked example ' + ex);
    }

    async getAllEntityTypes() {
        await this._ensureLoaded();
        return this._entities;
    }

    async lookupEntity(entityType, entityDisplay) {
        entityDisplay = entityDisplay.toLowerCase();
        if (entityType === 'tt:cryptocurrency_code') {
            if (entityDisplay === 'bitcoin') {
                const array = [
                    {"type":"tt:cryptocurrency_code","value":"bca","canonical":"bitcoin atom","name":"Bitcoin Atom"},
                    {"type":"tt:cryptocurrency_code","value":"bcd","canonical":"bitcoin diamond","name":"Bitcoin Diamond"},
                    {"type":"tt:cryptocurrency_code","value":"bcf","canonical":"bitcoin fast","name":"Bitcoin Fast"},
                    {"type":"tt:cryptocurrency_code","value":"bch","canonical":"bitcoin cash","name":"Bitcoin Cash"},
                    {"type":"tt:cryptocurrency_code","value":"bit","canonical":"first bitcoin","name":"First Bitcoin"},
                    {"type":"tt:cryptocurrency_code","value":"bitg","canonical":"bitcoin green","name":"Bitcoin Green"},
                    {"type":"tt:cryptocurrency_code","value":"btc","canonical":"bitcoin","name":"Bitcoin"},
                    {"type":"tt:cryptocurrency_code","value":"btcp","canonical":"bitcoin private","name":"Bitcoin Private"},
                    {"type":"tt:cryptocurrency_code","value":"btcs","canonical":"bitcoin scrypt","name":"Bitcoin Scrypt"},
                    {"type":"tt:cryptocurrency_code","value":"btpl","canonical":"bitcoin planet","name":"Bitcoin Planet"},
                    {"type":"tt:cryptocurrency_code","value":"god","canonical":"bitcoin god","name":"Bitcoin God"},
                    {"type":"tt:cryptocurrency_code","value":"sbtc","canonical":"super bitcoin","name":"Super Bitcoin"},
                    {"type":"tt:cryptocurrency_code","value":"ubtc","canonical":"united bitcoin","name":"United Bitcoin"},
                    {"type":"tt:cryptocurrency_code","value":"xbc","canonical":"bitcoin plus","name":"Bitcoin Plus"},
                    {"type":"tt:cryptocurrency_code","value":"xbtc21","canonical":"bitcoin 21","name":"Bitcoin 21"}
                ];
                return {
                    data: array,
                    meta: {"name":"Cryptocurrency Code","has_ner_support":1,"is_well_known":0}
                };
            } else if (entityDisplay === 'btc') {
                return {
                    data: [
                        {"type":"tt:cryptocurrency_code","value":"btc","canonical":"bitcoin","name":"Bitcoin"},
                    ],
                    meta: {"name":"Cryptocurrency Code","has_ner_support":1,"is_well_known":0}
                };
            } else if (entityDisplay === 'invalid') {
                return {
                    data: [],
                    meta: {"name":"Cryptocurrency Code","has_ner_support":1,"is_well_known":0}
                };
            } else {
                // unreachable test case
                throw new Error('Invalid entity ' + entityDisplay);
            }
        } else if (entityType === 'com.yelp:restaurant_cuisine') {
            if (entityDisplay === 'italian') {
                return {
                    data: [
                        {"type":"com.yelp:restaurant_cuisine","value":"italian","canonical":"italian","name":"Italian"},
                    ],
                    meta: {"name":"Yelp Cuisine","has_ner_support":1,"is_well_known":0}
                };
            } else {
                return {
                    data: [
                    ],
                    meta: {"name":"Yelp Cuisine","has_ner_support":1,"is_well_known":0}
                };
            }
        } else {
            return {
                data: [],
                meta: { "name": entityDisplay }
            };
        }
    }

    async lookupLocation(searchKey) {
        if (searchKey === 'seattle') {
            return [
     { latitude: 47.6038321,
       longitude: -122.3300624,
       display: 'Seattle, King County, Washington, USA',
       canonical: 'seattle king county washington usa',
       rank: 16,
       importance: 0.791543985387614 },
     { latitude: 20.7199684,
       longitude: -103.3763286,
       display: 'Seattle, Los Maestros, Zapopan, Jalisco, 38901, México',
       canonical: 'seattle los maestros zapopan jalisco 38901 méxico',
       rank: 22,
       importance: 0.30000000000000004 },
     { latitude: 25.18415975,
       longitude: 121.446939985985,
       display: '西雅圖, 淡水區, 北投里, 瀾尾埔, 淡水區, 新北市, 251, 臺灣',
       canonical: '西雅圖 淡水區 北投里 瀾尾埔 淡水區 新北市 251 臺灣',
       rank: 22,
       importance: 0.2 },
     { latitude: 41.9641881,
       longitude: -121.922629,
       display: 'Seattle, Dorris, Siskiyou County, California, USA',
       canonical: 'seattle dorris siskiyou county california usa',
       rank: 26,
       importance: 0.2 },
     { latitude: 14.6696779,
       longitude: 121.0988312,
       display:
        'Seattle, Vista Real Classica, Batasan Hills, 2nd District, Quezon City, Metro Manila, 1808, Philippines',
       canonical:
        'seattle vista real classica batasan hills 2nd district quezon city metro manila 1808 philippines',
       rank: 26,
       importance: 0.2 } ];
        } else if (searchKey === 'invalid') {
            return [];
        } else {
            // unreachable test case
            throw new Error('Invalid location ' + searchKey);
        }
    }

    async _load() {
        this._devices = (await util.promisify(fs.readFile)(this._thingpediafilename)).toString();
        for (const builtin in this._builtins)
            this._devices += '\n' + (await util.promisify(fs.readFile)(this._builtins[builtin].manifest)).toString();

        if (this._entityfilename)
            this._entities = JSON.parse(await util.promisify(fs.readFile)(this._entityfilename)).data;
        else
            this._entities = null;
    }

    _ensureLoaded() {
        if (this._loaded)
            return this._loaded;
        else
            return this._loaded = this._load();
    }

    async getSchemas(kinds, useMeta) {
        if (kinds.indexOf('org.thingpedia.test.timedout') >= 0) {
            const e = new Error('Connection timed out');
            e.code = 'ETIMEDOUT';
            throw e;
        }

        await this._ensureLoaded();

        // ignore kinds, just return the full file, SchemaRetriever will take care of the rest
        return this._devices;
    }

    getDeviceCode(kind) {
        const parsed = ThingTalk.Syntax.parse(this._devices);
        const found = parsed.classes.find((classDef) => classDef.kind === kind);
        if (!found)
            throw new Error('Not Found');
        return found.prettyprint();
    }

    getDeviceList(klass, page, page_size) {
        return Promise.resolve(ThingpediaDeviceFactories.devices.filter((d) => d.subcategory === klass).slice(page*page_size, page*page_size + page_size + 1));
    }
    async getDeviceSetup(kinds) {
        const ret = {};
        for (const k of kinds) {
            if (k === 'messaging' || k === 'org.thingpedia.builtin.matrix')
                ret[k] = {type:'interactive',category:'online', kind:'org.thingpedia.builtin.matrix', name:"Matrix Account"};
            else if (k === 'com.lg.tv.webos2')
                ret[k] = {type: 'discovery', discoveryType: 'upnp', text: 'LG WebOS TV'};
            else if (k === 'org.thingpedia.builtin.bluetooth.generic')
                ret[k] = {type: 'discovery', discoveryType: 'bluetooth', text: 'Generic Bluetooth Device'};
            else if (k === 'com.tumblr.blog')
                ret[k] = {type: 'multiple', choices: [{ type: 'oauth2', kind: 'com.tumblr', text: "Tumblr Account" }, { type: 'form', kind: 'com.tumblr2', text: 'Some other Tumblr Thing' }]};
            else if (k === 'com.instagram')
                ret[k] = {type: 'oauth2', kind: 'com.instagram', text: 'Instagram'};
            else if (k === 'org.thingpedia.iot.light-bulb')
                ret[k] = {type: 'multiple', text: 'Light Bulb', choices: [{ type: 'oauth2', kind: 'io.home-assistant', text: 'Home Assistant'}, { type: 'discovery', discoveryType: 'upnp', kind: 'com.hue', text:'Philips Hue'}] };
            else if (k === 'org.thingpedia.iot.door')
                ret[k] = {type: 'oauth2', kind: 'io.home-assistant', text: 'Home Assistant'};
            else if (k === 'org.thingpedia.rss')
                ret[k] = _rssFactory;
            else if (k === 'org.thingpedia.builtin.thingengine.home' || k === 'car')
                ret[k] = {type: 'multiple', choices: [] };
            else
                ret[k] = {type:'none',kind:k,text: k};
        }
        return ret;
    }

    async getAllDeviceNames() {
        await this._ensureLoaded();

        const parsed = ThingTalk.Syntax.parse(this._devices);
        let names = [];
        for (let classDef of parsed.classes) {
            names.push({
                kind: classDef.kind,
                kind_canonical: classDef.metadata.canonical
            });
        }
        return names;
    }

    getExamplesByKey(key) {
        if (key === '!! test command always failed !!') {
            return Promise.resolve(`dataset @org.thingpedia.generated.by_key.always_failed language "en" {
    action := @org.thingpedia.builtin.test.eat_data()
    #_[utterances=["eat test data"]]
    #_[preprocessed=["eat test data"]]
    #[id=1];

    query := @org.thingpedia.builtin.test.get_data()
    #_[utterances=["get test data"]]
    #_[preprocessed=["get test data"]]
    #[id=2];

    query (p_size : Measure(byte)) := @org.thingpedia.builtin.test.get_data(size=p_size)
    #_[utterances=["get ${'${p_size}'} test data"]]
    #_[preprocessed=["get ${'${p_size}'} test data"]]
    #[id=3];
}`);
        } else {
            return Promise.resolve(`dataset @org.thingpedia.generated.by_key language "en" {}`);
        }
    }

    async getExamplesByKinds(kinds) {
        assert.strictEqual(kinds.length, 1);

        return util.promisify(fs.readFile)(path.resolve(path.dirname(module.filename), 'examples/' + kinds[0] + '.tt'), { encoding: 'utf8' });
    }
}
