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

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('extract-translatable-annotations', {
        add_help: true,
        description: "Extract translatable annotations from a thingpedia file."
    });
    parser.add_argument('--output-format', {
        choices: ['gettext', 'translation'],
        default: 'gettext',
        help: 'gettext: use for builtin skills to print annotations in _() format later picked up by gettext' +
              ' translation: use for customs skills to print them in tsv format accepted by genienlp'
    });
    parser.add_argument('input_file', {
        help: 'Input Thingpedia file to read from'
    });
    parser.add_argument('-o', '--output', {
        required: true,
        help: 'Output Thingpedia file to write to'
    });
}

let output : fs.WriteStream;
let output_format : string;

function extract(key : string, str : unknown) {
    if (typeof str === 'boolean' || typeof str === 'number')
        return;
    if (typeof str === 'string') {
        if (output_format === 'gettext') {
            output.write(`/* ${key} */\n`);
            output.write(`let x = _(${stringEscape(str)});\n`);
        } else {
            // trim "
            output.write(`${key}\t${stringEscape(str).slice(1, -1)}\n`);
        }
    } else if (Array.isArray(str)) {
        for (let i = 0; i < str.length; i++)
            extract(`${key}[${i}]`, str[i]);
    } else if (typeof str === 'object' && str !== null) {
        for (const subkey in str) {
            if (subkey === 'type' || subkey === 'default')
                continue;
            extract(`${key};${subkey}`, str[subkey as keyof typeof str]);
        }
    } else {
        throw new TypeError(`Invalid translatable entry #_[${key}=${str}]`);
    }
}

export async function execute(args : any) {
    const code = (await pfs.readFile(args.input_file)).toString();
    const parsed = ThingTalk.Syntax.parse(code, ThingTalk.Syntax.SyntaxType.Normal, {
        locale: 'en-US',
        timezone: 'UTC'
    });
    assert(parsed instanceof ThingTalk.Ast.Library);

    output = fs.createWriteStream(args.output);
    output_format = args.output_format;

    // parse manifests
    for (const _class of parsed.classes) {
        for (const key in _class.metadata)
            extract(`${key}`, _class.metadata[key]);
        for (const what of ['queries', 'actions'] as const) {
            for (const name in _class[what]) {
                for (const key in _class[what][name].metadata)
                    extract(`${what}.${name}.${key}`, _class[what][name].metadata[key]);

                for (const argname of _class[what][name].args) {
                    const arg = _class[what][name].getArgument(argname)!;

                    for (const key in arg.metadata)
                        extract(`${what}.${name}.args.${argname}.${key}`, arg.metadata[key]);

                    // handle enums
                    if (arg.type.isEnum)
                        extract(`${what}.${name}.args.${argname}.enum`, arg.type);
                }
            }
        }
    }

    // parse datasets
    for (const _class of parsed.datasets) {
        for (const [ex_id, ex] of _class.examples.entries()) {
            for (const [uttr_id, uttr] of ex.utterances.entries()) {
                const key = `${_class.name}.${ex_id}.${uttr_id}`;
                output.write(`/* ${key} */\n`);
                output.write(`let x = _(${stringEscape(uttr)});\n`);
            }
        }
    }


}
