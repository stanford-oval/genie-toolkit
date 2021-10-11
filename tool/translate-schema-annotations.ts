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
// Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>

import * as argparse from 'argparse';
import assert from 'assert';
import * as fs from 'fs';
import { promises as pfs } from 'fs';
import * as ThingTalk from 'thingtalk';
import * as StreamUtils from "../lib/utils/stream-utils";

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('translate-schema-annotations', {
        add_help: true,
        description: "Translate a thingpedia file's annotations to another language."
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
    parser.add_argument('--translations-file', {
        required: true,
        help: 'File containing translations for each translatable string in tsv format'
    });
    parser.add_argument('input_file', {
        help: 'Input Thingpedia file to read'
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
}


function* returnAllKeys(key : string, str : unknown) : any {
    if (typeof str === 'string') {
        yield key;
    } else if (Array.isArray(str)) {
        for (let i = 0; i < str.length; i++)
            yield* returnAllKeys(`${key}[${i}]`, str[i]);
    } else if (typeof str === 'object' && str !== null) {
        for (const subkey in str) {
            if (subkey === 'type' || subkey === 'default')
                continue;
            yield* returnAllKeys(`${key};${subkey}`, str[subkey as keyof typeof str]);
        }
    } else {
        yield null;
    }
}

function processEnum(arg : any, iterKey : string,  translationDict : Map<string, string>) {
    const valList = [];
    for (const k of returnAllKeys(iterKey, arg.type)) {
        if (k === null)
            continue;
        assert(typeof arg.type === 'object');
        valList.push(translationDict.get(k));
    }

    if (typeof arg.metadata['canonical'] === 'string' || Array.isArray(arg.metadata['canonical']))
        arg.metadata['canonical'] = { 'base': arg.metadata['canonical'], 'enum_display': valList };
    else
        arg.metadata['canonical']['enum_display'] = valList;

}

function process(obj : any, iterKey : string,  translationDict : Map<string, string>) {
    for (const key in obj) {
        for (const k of returnAllKeys(iterKey + `.${key}`, obj[key])) {
            if (k === null)
                continue;
            if (Array.isArray(obj[key])) {
                let subKey = k.split('.').slice(-1);
                // TODO fix
                if (subKey.length !== 1) {
                    console.log(subKey);
                    continue;
                }
                subKey = subKey[0];
                const [, , id_] = /(.+?)\[(\d+)\]/.exec(subKey)!;
                obj[key][id_] = translationDict.get(k);
            } else if (typeof obj[key] === 'object') {
                let subKey = k.split(';').slice(1);
                // TODO fix
                if (subKey.length !== 1)
                    console.log(subKey);
                subKey = subKey[0];
                const [, substr, id_] = /(.+?)\[(\d+)\]/.exec(subKey)!;
                obj[key][substr][id_] = translationDict.get(k);
            } else {
                obj[key] = translationDict.get(k);
            }
        }
    }

}

export async function execute(args : any) {
    const code = (await pfs.readFile(args.input_file)).toString();
    const parsed = ThingTalk.Syntax.parse(code, ThingTalk.Syntax.SyntaxType.Normal, {
        locale: 'en-US',
        timezone: 'UTC'
    });
    assert(parsed instanceof ThingTalk.Ast.Library);

    const translationDict = new Map<string, string>();
    if (args.translations_file) {
        const translations = (await pfs.readFile(args.translations_file)).toString().split("\n");
        translations.forEach((line) => {
            const [origKey, value] = line.split('\t');
            translationDict.set(origKey, value);
        });
        for (const _class of parsed.classes) {
            for (const key in _class.metadata)
                _class.metadata[key] = translationDict.get(key);
            for (const what of ['queries', 'actions'] as Array<'queries' | 'actions'>) {
                for (const name in _class[what]) {
                    process(_class[what][name].metadata, `${what}.${name}`, translationDict);
                    for (const argname of _class[what][name].args) {
                        const arg = _class[what][name].getArgument(argname)!;
                        process(arg.metadata, `${what}.${name}.args.${argname}`, translationDict);

                        if (arg.type.isEnum)
                            processEnum(arg, `${what}.${name}.args.${argname}.enum`, translationDict);
                    }
                }
            }
        }
    }

    if (args.output) {
        args.output.end(parsed.prettyprint());
        await StreamUtils.waitFinish(args.output);
    }

}
