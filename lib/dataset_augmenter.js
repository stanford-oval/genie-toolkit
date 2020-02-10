// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');

const ParameterReplacer = require('./replace_parameters');
const SingleDeviceAugmenter = require('./single_device_augmenter');
const PPDBUtils = require('./ppdb');

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
        this._ppdb = options.ppdbFile || null;

        this._constProvider = constProvider;
        this._schemas = schemaRetriever;
        this._paramReplacer = new ParameterReplacer(this._schemas, this._constProvider, {
            locale: options.locale,
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
            debug: this._options.debug
        });

    }

    async _process(ex) {
        if (ex.flags.eval)
            return [ex];

        const ppdbProb = ex.flags.synthetic ?
            this._options.ppdbProbabilitySynthetic :
            this._options.ppdbProbabilityParaphrase;

        const output = await this._paramReplacer.process(ex);
        if (this._includeQuotedExample)
            output.push(ex);

        const ppdbex = PPDBUtils.apply(ex, this._ppdb, {
            probability: ppdbProb,
            debug: this._debug,
            rng: this._rng
        });
        if (ppdbex) {
            if (this._includeQuotedExample)
                output.push(ppdbex);
            output.push(...await this._paramReplacer.process(ppdbex));
        }

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
