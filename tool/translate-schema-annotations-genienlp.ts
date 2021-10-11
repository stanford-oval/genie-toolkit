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
import util from 'util';
import * as child_process from 'child_process';
import { promises as pfs } from 'fs';
import * as ThingTalk from 'thingtalk';
import * as StreamUtils from "../lib/utils/stream-utils";
// import {arrayEqual} from "../lib/dialogue-agent/dialogue_policy";
// import { stringEscape } from '../lib/utils/escaping';
// import {EnumType} from "thingtalk/dist/type";

export interface TranslationExample {
    id : string,
    utterance : string,
    translations : string[]
}

interface TranslateOptions {
    batch_size ?: number,
    temperature ?: number;
    debug ?: boolean
}

export default class Translator {
    private model : string;
    private options : TranslateOptions;
    private args : any;
    private child : any

    constructor(model : string, options : TranslateOptions) {
        this.model = model;
        this.options = options;

        this.args = [
            `server`,
            `--stdin`,
            `--path`, this.model,
            `--temperature`, this.options.temperature?.toString() ?? '0.2',
        ];

        this.child = child_process.spawn(`genienlp`, this.args, { stdio: ['pipe', 'pipe', 'inherit'] });

    }


    async translate(TranslationExamples : TranslationExample[]) {

        const stdout : string = await new Promise((resolve, reject) => {
            // this.child.stdin.start();
            this.child.stdin.write(JSON.stringify(
                {
                    id: 'req-0',
                    instances: TranslationExamples.map((ex) => ({
                        example_id: ex.id,
                        context: ex.utterance,
                        question: ''
                    }))
                }
            ));
            this.child.stdin.write('\n');
            // this.child.stdin.end();
            this.child.on('error', reject);
            this.child.stdout.on('error', reject);
            this.child.stdout.setEncoding('utf8');
            let buffer = '';
            this.child.stdout.on('data', (data : string) => {
                buffer += data;
            });
            this.child.stdout.on('end', () => resolve(buffer));
        });
        const translations = JSON.parse(stdout).instances;
        for (let i = 0; i < translations.length; i++)
            TranslationExamples[i].translations = translations[i];

        // output paraphrase result
        if (this.options.debug) {
            const output = util.promisify(fs.writeFile);
            await output(`./translation-result.json`, JSON.stringify(TranslationExamples, null, 2));
        }
    }
}


export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('translate-schema-annotations-genienlp', {
        add_help: true,
        description: "Subsample a Thingpedia library."
    });
    parser.add_argument('-o', '--output', {
        required: false,
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
    parser.add_argument('--translation-model', {
        required: false,
        help: ``
    });
    parser.add_argument('--translatable-strings-file', {
        required: false,
        help: ``
    });
    parser.add_argument('--translations-file', {
        required: false,
    });
    parser.add_argument('--batch-size', {
        required: false,
        type: Number,
        default: 32,
        help: ``
    });
    parser.add_argument('input_file', {
        help: 'Input Thingpedia file to subsample'
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
        let subKey = k.split(';').slice(1);
        // TODO fix
        if (subKey.length !== 1) {
            console.log(subKey);
            continue;
        }
        subKey = subKey[0];
        valList.push(translationDict.get(k));
    }

    if (typeof arg.metadata['canonical'] === 'string' || Array.isArray(arg.metadata['canonical']))
        arg.metadata['canonical'] = {'base': arg.metadata['canonical'], 'enum_display': valList};
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

    const TranslationExamples : TranslationExample[] = [];
    const inputs = (await pfs.readFile(args.translatable_strings_file)).toString().split("\n");
    inputs.forEach((line, index) => {
        const [origKey, value] = line.split(': ');
        TranslationExamples.push({id: origKey, utterance: value, translations : []});
    });

    const options : TranslateOptions = {batch_size : args.batch_size};
    const batchSize = args.batch_size ?? 32;

    const translator = new Translator(args.translation_model, options);

    const dataSize = TranslationExamples.length;
    const numBatches = Math.floor(dataSize / batchSize);
    for (let i = 0; i < numBatches; i++) {
        console.log(`At iteration ${i}`);
        await translator.translate(TranslationExamples.slice(i * batchSize, (i + 1) * batchSize));
    }

    const translationDict = new Map<string, string>();
    TranslationExamples.forEach((example, index) => {
        translationDict.set(example.id, example.translations[0]);
    });


    const code = (await pfs.readFile(args.input_file)).toString();
    const parsed = ThingTalk.Syntax.parse(code, ThingTalk.Syntax.SyntaxType.Normal, {
        locale: 'en-US',
        timezone: 'UTC'
    });
    assert(parsed instanceof ThingTalk.Ast.Library);
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

    if (args.output) {
        args.output.end(parsed.prettyprint());
        await StreamUtils.waitFinish(args.output);
    }

}
