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
"use strict";

const Stream = require('stream');

const ParameterReplacer = require('./replace_parameters');
const SingleDeviceAugmenter = require('./single_device_augmenter');

module.exports = class DatasetAugmenter extends Stream.Transform {
    constructor(schemaRetriever, constProvider, thingpediaClient, options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._options = options;
        this._rng = options.rng;
        this._includeQuotedExample = options.includeQuotedExample;

        this._singledevice = new SingleDeviceAugmenter(options.locale,
            thingpediaClient, options.singleDeviceExpandFactor, this._rng);

        this._constProvider = constProvider;
        this._schemas = schemaRetriever;
        this._paramReplacer = new ParameterReplacer(this._schemas, this._constProvider, {
            locale: options.locale,
            paramLocale: options.paramLocale,
            targetLanguage: options.targetLanguage,
            rng: this._rng,
            addFlag: true,
            quotedProbability: this._options.quotedProbability,
            untypedStringProbability: this._options.untypedStringProbability,
            maxSpanLength: this._options.maxSpanLength,
            syntheticExpandFactor: this._options.syntheticExpandFactor,
            noQuoteExpandFactor: this._options.noQuoteExpandFactor,
            paraphrasingExpandFactor: this._options.paraphrasingExpandFactor,
            replaceLocations: this._options.replaceLocations,
            replaceNumbers: this._options.replaceNumbers,
            cleanParameters: this._options.cleanParameters,
            requotable: this._options.requotable,
            samplingType: this._options.samplingType,
            subsetParamSet: this._options.subsetParamSet,
            numAttempts: this._options.numAttempts,
            debug: this._options.debug
        });

    }

    async _process(ex) {
        if (ex.flags.eval)
            return [ex];

        const output = await this._paramReplacer.process(ex);
        if (this._includeQuotedExample)
            output.push(ex);

        const singledeviceexs = await this._singledevice.process(ex);
        if (this._includeQuotedExample)
            output.push(...singledeviceexs);
        for (let singledeviceex of singledeviceexs)
            output.push(...await this._paramReplacer.process(singledeviceex));

        return output;
    }

    _flush(callback) {
        process.nextTick(callback);
    }

    _transform(inex, encoding, callback) {
        this._process(inex).then((output) => {
            for (let ex of output)
                this.push(ex);
            callback();
        }, (err) => {
            callback(err);
        });
    }
};
