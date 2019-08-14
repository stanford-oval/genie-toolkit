// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

const { choose } = require('../../lib/random');

function getEntityType(type) {
    if (type.isEntity)
        return type.type;
    if (type.isArray && type.elem.isEntity)
        return type.elem.type;
    return null;
}

module.exports = class ConstantSampler {
    constructor(schemaRetriever, options) {
        this._schemaRetriever = schemaRetriever;
        this._options = options;
        this._cached = {};
    }

    _endpoint(api) {
        return this._options.thingpedia_url + api
            + '?locale=' + this._options.locale
            + '&developer_key=' + this._options.developer_key;
    }

    _sampleEntities(data) {
        const sampled = choose(data, this._options.sample_size, this._options.rng);
        return sampled.map((entity) => {
            return {
                value: entity.value,
                display: entity.name
            };
        });
    }

    _sampleStrings(data) {
        const sampled = choose(data, this._options.sample_size, this._options.rng);
        return sampled.map((string) => string.preprocessed);
    }



    async _retrieveSamples(type, name) {
        const key = type + '+' + name;
        if (key in this._cached)
            return this._cached[key];

        const url = this._endpoint(`/api/v3/${type}/list/${name}`);
        const response = await Tp.Helpers.Http.get(url);
        const data = JSON.parse(response).data;
        const sampled = type === 'strings' ? this._sampleStrings(data) : this._sampleEntities(data);
        this._cached[key] = sampled;
        return sampled;
    }

    async _sampleOneDevice(device) {
        const deviceClass = await this._schemaRetriever.getFullSchema(device);
        const functions = Object.assign({}, deviceClass.queries, deviceClass.actions);
        const constants = [];
        for (let f in functions) {
            const functionDef = functions[f];
            for (let arg of functionDef.args) {
                const argument = functionDef.getArgument(arg);
                const string_values = argument.getAnnotation('string_values');
                if (string_values) {
                    const samples = await this._retrieveSamples('strings', string_values);
                    samples.forEach((sample) => {
                        constants.push([`param:@${device}.${f}:${arg}:String`, sample]);
                    });
                }
                const entityType = getEntityType(functionDef.getArgType(arg));
                if (entityType) {
                    const samples = await this._retrieveSamples('entities', entityType);
                    samples.forEach((sample) => {
                        constants.push([
                            `param:@${device}.${f}:${arg}:Entity(${entityType})`,
                            sample.value,
                            sample.display
                        ]);
                    });
                }
            }
        }
        return constants;
    }

    async sample() {
        let samples = [];
        for (let device of this._options.devices.split(','))
            samples = samples.concat(await this._sampleOneDevice(device));
        return samples;
    }

};
