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
import * as gettextParser from 'gettext-parser';
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
    parser.add_argument('--po-file', {
        required: true,
        help: 'PO file containing original and translated strings'
    });
    parser.add_argument('input_file', {
        help: 'Input Thingpedia file to read'
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
}

const translationDict = new Map<string, string>();

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

function processEnum(arg : any, iterKey : string,) {
    const valList : Array<string | undefined> = [];
    assert(typeof arg.type === 'object');
    for (const k of returnAllKeys(iterKey, arg.type)) {
        if (k === null)
            continue;
        valList.push(translationDict.get(k));
    }

    const keys : string[] = arg.type.entries;
    assert(keys.length === valList.length);

    const valueEnum = Object.fromEntries(keys.map((_, i) => [keys[i], [valList[i]]]));

    if (!arg.metadata['canonical'])
        arg.metadata['canonical'] = { 'value_enum': valueEnum } ;
    else if (typeof arg.metadata['canonical'] === 'string' || Array.isArray(arg.metadata['canonical']))
        arg.metadata['canonical'] = { 'base': arg.metadata['canonical'], 'value_enum': valueEnum };
    else
        arg.metadata['canonical']['value_enum'] = valueEnum;

}

function process(obj : any, iterKey : string) {
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

    const pofile = gettextParser.po.parse(await pfs.readFile(args.po_file, { encoding: 'utf8' }));

    // get translations for the default context
    const poObjects = pofile.translations[''];
    for (const msgid in poObjects) {
        const entry : gettextParser.GetTextTranslation = poObjects[msgid];
        const refKeys : string[]|undefined = entry.comments?.reference?.split('\n');
        const extKeys : string[]|undefined = entry.comments?.extracted?.split('\n');
        for (const keys of [refKeys, extKeys]) {
            if (!keys)
                continue;
            for (const k of keys) {
                assert(entry.msgstr.length === 1);
                translationDict.set(k, entry.msgstr[0]);
            }
        }
    }

    // handle manifest
    for (const _class of parsed.classes) {
        for (const key in _class.metadata)
            _class.metadata[key] = translationDict.get(key);
        for (const what of ['queries', 'actions'] as Array<'queries' | 'actions'>) {
            for (const name in _class[what]) {
                process(_class[what][name].metadata, `${what}.${name}`);
                for (const argname of _class[what][name].args) {
                    const arg = _class[what][name].getArgument(argname)!;
                    process(arg.metadata, `${what}.${name}.args.${argname}`);

                    if (arg.type.isEnum)
                        processEnum(arg, `${what}.${name}.args.${argname}.enum`);
                }
            }
        }
    }

    // handle dataset
    for (const _class of parsed.datasets) {
        for (const [ex_id, ex] of _class.examples.entries()) {
            for (const [uttr_id, _] of ex.utterances.entries()) {
                const key = `${_class.name}.${ex_id}.${uttr_id}`;
                ex.utterances[uttr_id] = translationDict.get(key)!;
            }
        }
    }

    if (args.output) {
        args.output.end(parsed.prettyprint());
        await StreamUtils.waitFinish(args.output);
    }

}
