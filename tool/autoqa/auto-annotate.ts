// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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
import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';

import * as StreamUtils from '../../lib/utils/stream-utils';
import { parseConstantFile } from '../lib/constant-file';
import AnnotationGenerator from './lib/annotation-generator';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('auto-annotate', {
        add_help: true,
        description: "Automatically generate annotations including canonicals"
    });
    parser.add_argument('--dataset', {
        required: true,
        choices: ['schemaorg', 'sgd', 'multiwoz', 'wikidata', 'custom'],
        help: 'The dataset to run autoQA on.'
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('-l', '--locale', {
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
    });
    parser.add_argument('--constants', {
        required: true,
        help: 'TSV file containing constant values to use.'
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--functions', {
        required: false,
        default: null,
        help: `List of functions to include, split by comma (no space). Include all functions if not specified`,
    });
    parser.add_argument('--entities', {
        required: false,
        help: 'Path to JSON file containing entity type definitions.'
    });
    parser.add_argument('--remove-existing-canonicals', {
        action: 'store_true',
        help: 'Remove all existing canonical annotations in the schema',
        default: false
    });
    parser.add_argument('--algorithms', {
        nargs: '*',
        help: 'Currently only `bart-paraphrase` is supported'
    });
    parser.add_argument('--batch-size', {
        required: false,
        type: Number,
        default: 64,
        help: `The batch size for auto paraphrase`
    });
    parser.add_argument('--language-model', {
        required: false,
        default: 'bert-large-uncased',
        help: `A string specifying a model name recognizable by the Transformers package (e.g. bert-base-uncased), `
            + `or a path to the directory where the model is saved`
    });
    parser.add_argument('--paraphraser-model', {
        required: false,
        help: `A path to the directory where the bart paraphraser model is saved`
    });
    parser.add_argument('--filtering', {
        required: false,
        default: false,
        action: 'store_true',
        help: `Enable filtering for phrase extraction.`
    });
    parser.add_argument('--type-based-projection', {
        required: false,
        default: false,
        action: 'store_true',
        help: `Make use of the entity type names when generating projection annotations`
    });
    parser.add_argument('--max-per-pos', {
        required: false,
        type: Number,
        default: 10,
        help: `The maximum number of canonicals per part of speech`
    });
    parser.add_argument('--annotate-property-canonical', {
        required: false,
        default: true,
        action: 'store_true',
        help: `Auto annotate canonicals of properties`
    });
    parser.add_argument('--no-annotate-property-canonical', {
        required: false,
        dest: 'annotate-property-canonical',
        action: 'store_false',
        help: `Do not auto annotate canonicals of properties`
    });
    parser.add_argument('--annotate-query-canonical', {
        required: false,
        default: false,
        action: 'store_true',
        help: `Auto annotate canonicals of queries`
    });
    parser.add_argument('--debug', {
        required: false,
        default: false,
        action: 'store_true',
        help: `Enable debugging, which will output intermediate result into files.`
    });
}

export async function execute(args : any) {
    const tpClient = new Tp.FileClient({ thingpedia: args.thingpedia, entities: args.entities, locale: args.locale });
    const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
    const classDefs = await Promise.all((await tpClient.getDeviceList()).map(async (device) => schemas.getFullMeta(device.primary_kind)));
    const entities = await tpClient.getAllEntityTypes();

    if (!args.algorithms) {
        for (const classDef of classDefs)
            args.output.write(classDef.prettyprint() + '\n');
        args.output.end();
    } else {
        const options = args;
        const constants = await parseConstantFile(args.locale, args.constants);
        const functions = args.functions ? args.functions.split(',') : null;

        for (const classDef of classDefs) {
            const generator = new AnnotationGenerator(classDef, entities, constants, functions, options);
            const annotatedClassDef = await generator.generate();
            args.output.write(annotatedClassDef.prettyprint());
        }
        args.output.end();
    }

    StreamUtils.waitFinish(args.output);
}
