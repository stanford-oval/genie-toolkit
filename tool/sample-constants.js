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

const fs = require('fs');
const seedrandom = require('seedrandom');
const ThingTalk = require('thingtalk');
const StreamUtils = require('../lib/stream-utils');

const ConstantSampler = require('./lib/constants-sampler');
const FileThingpediaClient = require('./lib/file_thingpedia_client');

const DEFAULT_THINGPEDIA_URL = 'https://thingpedia.stanford.edu/thingpedia';

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('sample-constants', {
            addHelp: true,
            description: "Sample constants for parameters from entities and string values."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to .tt file containing signature, type and mixin definitions.'
        });
        parser.addArgument('--thingpedia-url', {
            required: false,
            defaultValue: DEFAULT_THINGPEDIA_URL,
            help: `base URL of Thingpedia server to contact; defaults to '${DEFAULT_THINGPEDIA_URL}'`
        });
        parser.addArgument(['-l', '--locale'], {
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
        });
        parser.addArgument('--developer-key', {
            required: true,
            help: `developer key to use when contacting Thingpedia.`
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
        parser.addArgument('--sample-size', {
            defaultValue: 10,
            help: 'Number of samples per entity or string value'
        });
        parser.addArgument('--devices', {
            required: true,
            help: `The list of devices to sample, separated by comma`
        });
    },


    async execute(args) {
        const options = {
            locale: args.locale,
            rng: seedrandom.alea(args.random_seed),
            thingpedia_url: args.thingpedia_url,
            developer_key: args.developer_key,
            devices: args.devices,
            sample_size: args.sample_size
        };
        const tpClient = new FileThingpediaClient(args);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);
        const sampler = new ConstantSampler(schemaRetriever, options);
        const constants = await sampler.sample();
        args.output.end(constants.map((c) => c.join('\t')).join('\n'));

        StreamUtils.waitFinish(args.output);
    }
};
