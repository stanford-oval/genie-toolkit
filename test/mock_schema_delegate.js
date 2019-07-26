"use strict";

const util = require('util');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const TpClient = require('thingpedia-client');

const Thingpedia = require('./thingpedia.json');
const ThingpediaDeviceFactories = require('./thingpedia-device-factories.json');
const fs = require('fs');
const path = require('path');

// Parse the semi-obsolete JSON format for schemas used
// by Thingpedia into a FunctionDef
function makeSchemaFunctionDef(functionType, functionName, schema, isMeta) {
    const args = [];
    // compat with Thingpedia API quirks
    const types = schema.types || schema.schema;

    types.forEach((type, i) => {
        type = Type.fromString(type);
        const argname = schema.args[i];
        const argrequired = !!schema.required[i];
        const arginput = !!schema.is_input[i];

        let direction;
        if (argrequired)
            direction = Ast.ArgDirection.IN_REQ;
        else if (arginput)
            direction = Ast.ArgDirection.IN_OPT;
        else
            direction = Ast.ArgDirection.OUT;
        const metadata = {};
        if (isMeta) {
            metadata.prompt = schema.questions[i] || '';
            metadata.canonical = schema.argcanonicals[i] || argname;
        }
        const annotations = {};

        args.push(new Ast.ArgumentDef(direction, argname,
            type, metadata, annotations));
    });

    const metadata = {};
    if (isMeta) {
        metadata.canonical = schema.canonical || '';
        metadata.confirmation = schema.confirmation || '';
    }
    const annotations = {};

    return new Ast.FunctionDef(functionType,
                               functionName,
                               args,
                               schema.is_list,
                               schema.is_monitorable,
                               metadata,
                               annotations);
}

function makeSchemaClassDef(kind, schema, isMeta) {
    const queries = {};
    for (let name in schema.queries)
        queries[name] = makeSchemaFunctionDef('query', name, schema.queries[name], isMeta);
    const actions = {};
    for (let name in schema.actions)
        actions[name] = makeSchemaFunctionDef('action', name, schema.actions[name], isMeta);

    const imports = [];
    const metadata = {};
    const annotations = {};
    return new Ast.ClassDef(kind, null, queries, actions,
                            imports, metadata, annotations);
}

class MockSchemaDelegate extends TpClient.BaseClient {
    constructor() {
        super();
        this._schema = {};
        this._meta = {};
        this._mixins = {};
    }

    // The Thingpedia APIs were changed to return ThingTalk class
    // definitions rather than JSON
    // We convert our JSON datafiles into ThingTalk code here

    async getSchemas(kinds, useMeta) {
        if (kinds.indexOf('org.thingpedia.test.timedout') >= 0) {
            const e = new Error('Connection timed out');
            e.code = 'ETIMEDOUT';
            throw e;
        }

        const source = useMeta ? this._meta : this._schema;

        const classes = [];
        for (let kind of kinds) {
            // emulate Thingpedia's behavior of creating an empty class
            // for invalid/unknown/invisible devices
            if (!source[kind])
                source[kind] = { queries: {}, actions: {} };
            classes.push(makeSchemaClassDef(kind, source[kind], useMeta));
        }
        const input = new Ast.Input.Meta(classes, []);
        return input.prettyprint();
    }

    getDeviceCode(kind) {
        return util.promisify(fs.readFile)(path.resolve(path.dirname(module.filename), kind + '.tt'), { encoding: 'utf8' });
    }

    getDeviceList(klass, page, page_size) {
        return Promise.resolve(ThingpediaDeviceFactories.devices.filter((d) => d.subcategory === klass).slice(page*page_size, page*page_size + page_size + 1));
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

    getExamplesByKinds(kinds) {
        assert.strictEqual(kinds.length, 1);
        return util.promisify(fs.readFile)(path.resolve(path.dirname(module.filename), 'examples/' + kinds[0] + '.tt'), { encoding: 'utf8' });
    }

    async lookupEntity(entityType, entityDisplay) {
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
        } else {
            throw new Error('Invalid entity type ' + entityType);
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
}
module.exports = new MockSchemaDelegate();
for (let dev of Thingpedia.data) {
    module.exports._meta[dev.kind] = dev;
    module.exports._schema[dev.kind] = {
        queries: {},
        actions: {}
    };
    for (let what of ['queries', 'actions']) {
        for (let name in dev[what]) {
            let from = dev[what][name];
            module.exports._schema[dev.kind][what][name] = {
                types: from.schema,
                args: from.args,
                required: from.required,
                is_input: from.is_input,
                is_list: from.is_list,
                is_monitorable: from.is_monitorable
            };
        }
    }
}
