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

    getDeviceFactories(klass) {
        return Promise.resolve(ThingpediaDeviceFactories.filter((d) => d.subcategory === klass));
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