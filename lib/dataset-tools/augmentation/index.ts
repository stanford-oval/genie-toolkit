// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import Stream from 'stream';
import { SchemaRetriever } from 'thingtalk';
import * as Tp from 'thingpedia';

import ParameterReplacer from './replace_parameters';
import SingleDeviceAugmenter from './single_device_augmenter';

import { SentenceExample } from '../parsers';

interface DatasetAugmenterOptions {
    locale : string;
    paramLocale : string;
    rng : () => number;
    debug : boolean;

    singleDeviceExpandFactor : number;
    quotedProbability : number;
    untypedStringProbability : number;
    maxSpanLength : number;
    syntheticExpandFactor : number;
    noQuoteExpandFactor : number;
    paraphrasingExpandFactor : number;

    includeQuotedExample : boolean;
    cleanParameters : boolean;
    requotable : boolean;

    samplingType : 'random' | 'uniform' | 'default';
    subsetParamSet : [number, number];
    numAttempts : number;
}

interface ParameterRecord {
    preprocessed : string;
    weight : number;
}
interface ParameterProvider {
    get(type : 'entity'|'string', key : string) : Promise<ParameterRecord[]>;
}

export default class DatasetAugmenter extends Stream.Transform {
    private _options : DatasetAugmenterOptions;
    private _rng : () => number;
    private _includeQuotedExample : boolean;

    private _singledevice : SingleDeviceAugmenter;
    private _paramReplacer : ParameterReplacer;

    constructor(schemaRetriever : SchemaRetriever,
                constProvider : ParameterProvider,
                thingpediaClient : Tp.BaseClient,
                options : DatasetAugmenterOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._options = options;
        this._rng = options.rng;
        this._includeQuotedExample = options.includeQuotedExample;

        this._singledevice = new SingleDeviceAugmenter(options.locale,
            thingpediaClient, options.singleDeviceExpandFactor, this._rng);

        this._paramReplacer = new ParameterReplacer({
            thingpediaClient: thingpediaClient,
            schemaRetriever: schemaRetriever,
            constProvider: constProvider,

            paramLocale: options.paramLocale,
            rng: this._rng,
            addFlag: true,
            quotedProbability: this._options.quotedProbability,
            untypedStringProbability: this._options.untypedStringProbability,
            maxSpanLength: this._options.maxSpanLength,
            syntheticExpandFactor: this._options.syntheticExpandFactor,
            noQuoteExpandFactor: this._options.noQuoteExpandFactor,
            paraphrasingExpandFactor: this._options.paraphrasingExpandFactor,
            cleanParameters: this._options.cleanParameters,
            requotable: this._options.requotable,
            samplingType: this._options.samplingType,
            subsetParamSet: this._options.subsetParamSet,
            numAttempts: this._options.numAttempts,
            debug: this._options.debug
        });

    }

    private async _process(ex : SentenceExample) {
        if (ex.flags.eval)
            return [ex];

        const output = await this._paramReplacer.process(ex);
        if (this._includeQuotedExample)
            output.push(ex);

        const singledeviceexs = await this._singledevice.process(ex);
        if (this._includeQuotedExample)
            output.push(...singledeviceexs);
        for (const singledeviceex of singledeviceexs)
            output.push(...await this._paramReplacer.process(singledeviceex));

        return output;
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }

    _transform(inex : SentenceExample, encoding : BufferEncoding, callback : (err ?: Error|null) => void) {
        this._process(inex).then((output) => {
            for (const ex of output)
                this.push(ex);
            callback();
        }, (err) => {
            callback(err);
        });
    }
}
