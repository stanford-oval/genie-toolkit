// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Silei Xu <silei@cs.stanford.edu>
"use strict";

import { choose } from '../../lib/utils/random';
import { sampleString } from '../../lib/utils/misc-utils';
import * as i18n from '../../lib/i18n';

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


export default class ConstantSampler {
    constructor(schemaRetriever, constProvider, options) {
        this._schemaRetriever = schemaRetriever;
        this._constProvider = constProvider;
        this._options = options;
        this._langPack = i18n.get(options.locale);
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
        const langPack = this._langPack;
        const sampleOne = function(string) {
            let attempts = 1000;
            while (attempts > 0) {
                const sampled = sampleString(string.value.split(' '), langPack, rng);
                if (sampled)
                    return sampled;
                attempts -= 1;
            }
            return null;
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

                        if (arg === 'id') {
                            samples.forEach((sample) => {
                                constants.push([`param:@${device}.${f}:${arg}:String`, sample]);
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
                            constants.push([`param:@${device}.${f}:${arg}:String`, sample.display]);
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

}
