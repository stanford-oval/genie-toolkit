"use strict";

const Thingpedia = require('./thingpedia.json');
const ThingpediaDeviceFactories = require('./thingpedia-device-factories.json');
const fs = require('fs');
const path = require('path');

module.exports = {
    _schema: {},
    _meta: {},

    getSchemas() {
        return this._schema;
    },

    getMetas() {
        return this._meta;
    },

    getDeviceCode(kind) {
        return new Promise((resolve, reject) => {
            fs.readFile(path.resolve(path.dirname(module.filename), kind + '.json'), (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(JSON.parse(data));
            });
        });
    },

    getDeviceList(klass, page, page_size) {
        return Promise.resolve({ devices: ThingpediaDeviceFactories.devices.filter((d) => d.subcategory === klass).slice(page*page_size, page*page_size + page_size + 1) });
    },

    getExamplesByKinds(kinds) {
        return Promise.all(kinds.map((k) => {
            return new Promise((resolve, reject) => {
                fs.readFile(path.resolve(path.dirname(module.filename), 'examples/' + k + '.json'), (err, data) => {
                    if (err)
                        reject(err);
                    else
                        resolve(JSON.parse(data));
                });
            });
        })).then((arrays) => {
            let flat = [];
            for (let arr of arrays)
                flat.push(...arr);
            return flat;
        });
    },

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
                array.meta = {"name":"Cryptocurrency Code","has_ner_support":1,"is_well_known":0};
                return array;
            } else if (entityDisplay === 'btc') {
                const array = [
                    {"type":"tt:cryptocurrency_code","value":"btc","canonical":"bitcoin","name":"Bitcoin"},
                ];
                array.meta = {"name":"Cryptocurrency Code","has_ner_support":1,"is_well_known":0};
                return array;
            } else if (entityDisplay === 'invalid') {
                const array = [];
                array.meta = {"name":"Cryptocurrency Code","has_ner_support":1,"is_well_known":0};
                return array;
            } else {
                // unreachable test case
                throw new Error('Invalid entity ' + entityDisplay);
            }
        } else {
            throw new Error('Invalid entity type ' + entityType);
        }
    }
};
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