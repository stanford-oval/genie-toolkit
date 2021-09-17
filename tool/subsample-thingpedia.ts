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

import * as argparse from 'argparse';
import assert from 'assert';
import * as fs from 'fs';
import { promises as pfs } from 'fs';
import * as ThingTalk from 'thingtalk';
import seedrandom from 'seedrandom';

import * as StreamUtils from '../lib/utils/stream-utils';
import { coin } from '../lib/utils/random';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('subsample-thingpedia', {
        add_help: true,
        description: "Subsample a Thingpedia library."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
    });
    parser.add_argument('--fraction', {
        required: true,
        type: Number,
        help: "The portion of the library to sample."
    });
    parser.add_argument('input_file', {
        help: 'Input Thingpedia file to subsample'
    });
    parser.add_argument('--random-seed', {
        default: 'almond is awesome',
        help: 'Random seed'
    });
}

export async function execute(args : any) {
    const rng = seedrandom.alea(args.random_seed);

    const parsed = ThingTalk.Syntax.parse(await pfs.readFile(args.input_file, { encoding: 'utf8' }), ThingTalk.Syntax.SyntaxType.Normal, { locale: args.locale, timezone: args.timezone });
    assert(parsed instanceof ThingTalk.Ast.Library);
    parsed.classes = parsed.classes.filter(() => coin(args.fraction, rng));

    args.output.end(parsed.prettyprint());
    await StreamUtils.waitFinish(args.output);
}
