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

const { choose } = require('../../lib/random');
const { sampleString } = require('../../lib/utils');

function getEntityType(type) {
    if (type.isEntity)
        return type.type;
    if (type.isArray && type.elem.isEntity)
        return type.elem.type;
    return null;
}

function isString(type) {
    if (type.isString)
        return true;
    if (type.isArray && type.elem.isString)
        return true;
    return false;
}


module.exports = class ConstantSampler {
    constructor(schemaRetriever, constProvider, options) {
        this._schemaRetriever = schemaRetriever;
        this._constProvider = constProvider;
        this._options = options;
        this._cached = {};
    }

    _sampleEntities(data) {
        const sampled = choose(data.filter((entity) => entity.name.length < 25), this._options.sample_size, this._options.rng);
        return sampled.filter((entity) => /^[a-zA-Z0-9 .]*$/.test(entity.name)).map((entity) => {
            return {
                value: entity.value,
                display: entity.name
            };
        });
    }

    _sampleStrings(data) {
        const rng = this._options.rng;
        const sampleOne = function(string) {
            const sampled = sampleString(string.preprocessed.split(' '), rng);
            if (sampled)
                return sampled.join(' ');
        };
        const sampled = choose(data.map(sampleOne).filter(Boolean), this._options.sample_size, rng);
        return sampled.filter((string) => /^[a-zA-Z0-9 .]*$/.test(string));
    }


    async _retrieveSamples(type, name) {
        const key = type + '+' + name;
        if (key in this._cached)
            return this._cached[key];

        const data = await this._constProvider.get(type, name);
        if (data.length === 0)
            return [];
        const sampled = type === 'string' ? this._sampleStrings(data) : this._sampleEntities(data);
        this._cached[key] = sampled;
        return sampled;
    }

    async _sampleOneDevice(device) {
        const deviceClass = await this._schemaRetriever.getFullSchema(device);
        const functions = Object.assign({}, deviceClass.queries, deviceClass.actions);
        const constants = [];
        for (let f in functions) {
            const functionDef = functions[f];
            for (let argument of functionDef.iterateArguments()) {
                const arg = argument.name;
                const string_values = argument.getAnnotation('string_values');
                const entityType = getEntityType(functionDef.getArgType(arg));
                if (string_values) {
                    let samples = await this._retrieveSamples('string', `org.schema:${f}_${arg}`);
                    if (samples.length === 0)
                        samples = await this._retrieveSamples('string', string_values);
                    if (entityType) {
                        if (['tt:hashtag', 'tt:username'].includes(entityType)) {
                            samples.forEach((sample) => {
                                constants.push([`param:@${device}.${f}:${arg}:Entity(${entityType})`, sample]);
                            });
                        } else {
                            samples.forEach((sample) => {
                                constants.push([`param:@${device}.${f}:${arg}:Entity(${entityType})`, `null`, sample]);
                            });
                        }
                    } else if (isString(argument.type)) {
                        samples.forEach((sample) => {
                            constants.push([`param:@${device}.${f}:${arg}:String`, sample]);
                        });
                    }
                } else if (entityType) {
                    const samples = await this._retrieveSamples('entity', entityType);
                    samples.forEach((sample) => {
                        constants.push([
                            `param:@${device}.${f}:${arg}:Entity(${entityType})`,
                            sample.value,
                            sample.display
                        ]);
                    });

                    if (arg === 'id') {
                        samples.forEach((sample) => {
                            constants.push([`param:@${device}.${f}:${arg}:String`, sample.display.toLowerCase()]);
                        });
                    }
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
