// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import { Type, SchemaRetriever } from 'thingtalk';

import { choose } from '../../utils/random';
import { sampleString } from '../../utils/misc-utils';
import * as I18n from '../../i18n';

function getEntityType(type : Type) : string|null {
    if (type instanceof Type.Entity)
        return type.type;
    if (type instanceof Type.Array)
        return getEntityType(type.elem as Type);
    return null;
}

function isString(type : Type) : boolean {
    if (type.isString)
        return true;
    if (type instanceof Type.Array)
        return isString(type.elem as Type);
    return false;
}

interface EntityRecord {
    type : string;
    value : string;
    canonical : string;
    name : string;
}
interface ParameterRecord {
    preprocessed : string;
    value : string;
    weight : number;
}
interface ParameterProvider {
    get(type : 'entity'|'string', key : string) : Promise<ParameterRecord[]>;
    getEntity(key : string) : Promise<EntityRecord[]>;
}

interface ConstantSamplerOptions {
    locale : string;
    rng : () => number;
    devices : string;
    sample_size : number;
}

interface Entity {
    value : string;
    display : string;
}

export default class ConstantSampler {
    private _schemaRetriever : SchemaRetriever;
    private _constProvider : ParameterProvider;
    private _options : ConstantSamplerOptions;
    private _langPack : I18n.LanguagePack;
    private _cachedStrings : Record<string, string[]>;
    private _cachedEntities : Record<string, Entity[]>;

    constructor(schemaRetriever : SchemaRetriever,
                constProvider : ParameterProvider,
                options : ConstantSamplerOptions) {
        this._schemaRetriever = schemaRetriever;
        this._constProvider = constProvider;
        this._options = options;
        this._langPack = I18n.get(options.locale);
        this._cachedStrings = {};
        this._cachedEntities = {};
    }

    private _sampleEntities(data : EntityRecord[]) : Entity[] {
        const sampled = choose(data.filter((entity) => entity.name.length < 25), this._options.sample_size, this._options.rng);
        return sampled.filter((entity) => /^[a-zA-Z0-9 .]*$/.test(entity.name)).map((entity) => {
            return {
                value: entity.value,
                display: entity.name
            };
        });
    }

    private _sampleStrings(data : ParameterRecord[]) : string[] {
        const rng = this._options.rng;
        const langPack = this._langPack;
        const sampleOne = function(string : ParameterRecord) : string|null {
            let attempts = 1000;
            while (attempts > 0) {
                const sampled = sampleString(string.value.split(' '), langPack, rng);
                if (sampled)
                    return sampled;
                attempts -= 1;
            }
            return null;
        };
        const sampled = choose(data.map(sampleOne).filter(Boolean) as string[], this._options.sample_size, rng);
        return sampled.filter((string) => /^[a-zA-Z0-9 .]*$/.test(string));
    }

    private async _retrieveStringSamples(name : string) {
        if (name in this._cachedStrings)
            return this._cachedStrings[name];

        const data = await this._constProvider.get('string', name);
        if (data.length === 0)
            return [];
        const sampled = this._sampleStrings(data);
        this._cachedStrings[name] = sampled;
        return sampled;
    }

    private async _retrieveEntitySamples(name : string) {
        if (name in this._cachedEntities)
            return this._cachedEntities[name];

        const data = await this._constProvider.getEntity(name);
        if (data.length === 0)
            return [];
        const sampled = this._sampleEntities(data);
        this._cachedEntities[name] = sampled;
        return sampled;
    }

    private async _sampleOneDevice(device : string) {
        const deviceClass = await this._schemaRetriever.getFullSchema(device);
        const functions = Object.assign({}, deviceClass.queries, deviceClass.actions);
        const constants : string[][] = [];
        for (const f in functions) {
            const functionDef = functions[f];
            for (const argument of functionDef.iterateArguments()) {
                const arg = argument.name;
                const string_values = argument.getImplementationAnnotation<string>('string_values');
                const entityType = getEntityType(argument.type);
                if (string_values) {
                    let samples : string[] = await this._retrieveStringSamples(`org.schema:${f}_${arg}`);
                    if (samples.length === 0)
                        samples = await this._retrieveStringSamples(string_values);
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
                    const samples = await this._retrieveEntitySamples(entityType);
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

    async sample() : Promise<string[][]> {
        const samples : string[][] = [];
        for (const device of this._options.devices.split(',')) {
            for (const sample of await this._sampleOneDevice(device))
                samples.push(sample);
        }
        return samples;
    }

}
