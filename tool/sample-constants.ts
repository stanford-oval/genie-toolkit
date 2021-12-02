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

import * as argparse from 'argparse';
import * as fs from 'fs';
import seedrandom from 'seedrandom';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import * as StreamUtils from '../lib/utils/stream-utils';
import ConstantSampler from '../lib/dataset-tools/mturk/constants-sampler';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('sample-constants', {
        add_help: true,
        description: "Sample constants for parameters from entities and string values."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to .tt file containing signature, type and mixin definitions.'
    });
    parser.add_argument('--parameter-datasets', {
        required: true,
        help: 'TSV file containing the paths to datasets for strings and entity types.'
    });
    parser.add_argument('--random-seed', {
        default: 'almond is awesome',
        help: 'Random seed'
    });
    parser.add_argument('--sample-size', {
        default: 10,
        help: 'Number of samples per entity or string value'
    });
    parser.add_argument('--devices', {
        required: false,
        help: `The list of devices to sample, separated by comma`
    });
}

export async function execute(args : any) {
    const options = {
        devices: args.devices,
        sample_size: args.sample_size,
        rng: seedrandom.alea(args.random_seed),
        locale: args.locale
    };
    const tpClient = new Tp.FileClient(args);
    const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);
    const constProvider = new Tp.FileParameterProvider(args.parameter_datasets, args.locale);
    await constProvider.load();
    if (!options.devices)
        options.devices = (await tpClient.getAllDeviceNames()).map((dev) => dev.kind).join(',');

    const sampler = new ConstantSampler(schemaRetriever, constProvider, options);

    const constants = await sampler.sample();
    args.output.end(constants.map((c) => c.join('\t')).join('\n') + '\n');

    StreamUtils.waitFinish(args.output);
}
