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

import * as I18n from '../lib/i18n';
import { stringEscape } from '../lib/utils/escaping';
import { Choice, Replaceable } from '../lib/utils/template-string';

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

let output : fs.WriteStream;

function extract(key : string, str : unknown) {
    if (typeof str === 'boolean' || typeof str === 'number')
        return;
    if (typeof str === 'string') {
        output.write(`/* ${key} */\n`);
        output.write(`let x = _(${stringEscape(str)});\n`);
    } else if (Array.isArray(str)) {
        for (let i = 0; i < str.length; i++)
            extract(`${key}[${i}]`, str[i]);
    } else if (typeof str === 'object' && str !== null) {
        for (const subkey in str) {
            if (subkey === 'type' || subkey === 'default')
                continue;
            extract(`${key}.${subkey}`, str[subkey as keyof typeof str]);
        }
    } else {
        throw new TypeError(`Invalid translatable entry #_[${key}=${str}]`);
    }
}

function makeChoice(choices : Replaceable[]) {
    assert(choices.length > 0);
    if (choices.length === 1)
        return choices[0].toString();
    return new Choice(choices).toString();
}

function extractFunctionCanonical(langPack : I18n.LanguagePack, key : string, fndef : ThingTalk.Ast.FunctionDef, str : unknown) {
    const normalized = langPack.preprocessFunctionCanonical(str, fndef.functionType, 'user', fndef.is_list);

    output.write(`/* ${key} */\n`);
    output.write(`let x = pgettext(${stringEscape(key)}, ${stringEscape(makeChoice(normalized))});\n`);
}

function extractParameterCanonical(langPack : I18n.LanguagePack, key : string, str : unknown) {
    const normalized = langPack.preprocessParameterCanonical(str, 'user');

    output.write(`/* ${key}.default */\n`);
    output.write(`/* Translators: this is the POS to use as default for agent replies, it is a POS tag, it should not be translated */\n`);
    output.write(`let x = pgettext(${stringEscape(key + '.default')}, ${stringEscape(normalized.default)});\n`);

    for (const subkey of ['base', 'base_projection', 'argmin', 'argmax', 'projection', 'filter'] as const) {
        if (normalized[subkey].length === 0)
            continue;
        const fullkey = `${key}.${subkey}`;
        output.write(`/* ${fullkey} */\n`);
        output.write(`let x = pgettext(${stringEscape(fullkey)}, ${stringEscape(makeChoice(normalized[subkey]))});\n`);
    }

    for (const enum_ in normalized.enum_filter) {
        const enum_options = normalized.enum_filter[enum_];
        if (enum_options.length === 0)
            continue;

        const fullkey = `${key}.enum.${enum_}`;
        output.write(`/* ${fullkey} */\n`);
        output.write(`let x = pgettext(${stringEscape(fullkey)}, ${stringEscape(makeChoice(enum_options))});\n`);
    }
}

export async function execute(args : any) {
    const langPack = I18n.get('en-US');

    const code = (await pfs.readFile(args.input_file)).toString();
    const parsed = ThingTalk.Syntax.parse(code, ThingTalk.Syntax.SyntaxType.Normal, {
        locale: 'en-US',
        timezone: 'UTC'
    });
    assert(parsed instanceof ThingTalk.Ast.Library);

    output = fs.createWriteStream(args.output);

    // parse manifest
    for (const _class of parsed.classes) {
        for (const key in _class.nl_annotations)
            extract(`${key}`, _class.nl_annotations[key]);
        for (const what of ['queries', 'actions'] as const) {
            for (const name in _class[what]) {
                const fndef = _class[what][name];
                for (const key in fndef.nl_annotations) {
                    if (key === 'canonical')
                        extractFunctionCanonical(langPack, `${what}.${name}.${key}`, fndef, fndef.nl_annotations[key]);
                    else
                        extract(`${what}.${name}.${key}`, fndef.nl_annotations[key]);
                }

                for (const argname of _class[what][name].args) {
                    const arg = _class[what][name].getArgument(argname)!;

                    for (const key in arg.nl_annotations) {
                        if (key === 'canonical')
                            extractParameterCanonical(langPack, `${what}.${name}.args.${argname}.${key}`, arg.nl_annotations[key]);
                        else
                            extract(`${what}.${name}.args.${argname}.${key}`, arg.nl_annotations[key]);
                    }

                    // handle enums
                    if (arg.type.isEnum)
                        extract(`${what}.${name}.args.${argname}.enum`, arg.type);
                }
            }
        }
    }

    // parse dataset
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
