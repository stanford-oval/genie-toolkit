// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
//         Mehrad Moradshahi <mehrad@cs.stanford.edu>

import * as argparse from 'argparse';
import assert from 'assert';
import * as fs from 'fs';
import { promises as pfs } from 'fs';
import * as ThingTalk from 'thingtalk';

import { stringEscape } from '../lib/utils/escaping';

import { processLibrary } from './lib/extract-translatable';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('extract-translatable-annotations', {
        add_help: true,
        description: "Extract translatable annotations from a thingpedia file into a JS file to be processed by xgettext."
    });
    parser.add_argument('input_file', {
        help: 'Input Thingpedia file to read from'
    });
    parser.add_argument('-o', '--output', {
        required: true,
        help: 'Output file to write to'
    });
}

export async function execute(args : any) {
    const code = (await pfs.readFile(args.input_file)).toString();
    const parsed = ThingTalk.Syntax.parse(code, ThingTalk.Syntax.SyntaxType.Normal, {
        locale: 'en-US',
        timezone: 'UTC'
    });
    assert(parsed instanceof ThingTalk.Ast.Library);

    const output = fs.createWriteStream(args.output);

    for (const string of processLibrary(parsed)) {
        output.write(`/* ${string.key} */\n`);
        if (string.comment)
            output.write(`/* ${string.comment} */\n`);
        if (string.context)
            output.write(`let x = pgettext(${stringEscape(string.context)}, ${stringEscape(string.object[string.field])});\n`);
        else
            output.write(`let x = _(${stringEscape(string.object[string.field])});\n`);
    }

    output.end();
}
