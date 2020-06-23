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
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const StreamUtils = require('../lib/utils/stream-utils');
const ConstantSampler = require('./lib/constants-sampler');
const FileParameterProvider = require('./lib/file_parameter_provider');


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
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to .tt file containing signature, type and mixin definitions.'
        });
        parser.addArgument('--parameter-datasets', {
            required: true,
            help: 'TSV file containing the paths to datasets for strings and entity types.'
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
            devices: args.devices,
            sample_size: args.sample_size,
            rng: seedrandom.alea(args.random_seed),
            locale: args.locale
        };
        const tpClient = new Tp.FileClient(args);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);
        const constProvider = new FileParameterProvider(args.parameter_datasets);
        await constProvider.open();

        const sampler = new ConstantSampler(schemaRetriever, constProvider, options);

        const constants = await sampler.sample();
        args.output.end(constants.map((c) => c.join('\t')).join('\n') + '\n');

        StreamUtils.waitFinish(args.output);
        await constProvider.close();
    }
};
