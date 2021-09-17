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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import * as argparse from 'argparse';
import seedrandom from 'seedrandom';
import * as fs from 'fs';
import byline from 'byline';
import csvstringify from 'csv-stringify';
import Stream from 'stream';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import { SentenceExample, DatasetParser } from '../lib/dataset-tools/parsers';
import SentenceSampler from '../lib/dataset-tools/mturk/sampler';
import * as StreamUtils from '../lib/utils/stream-utils';
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import { parseConstantFile } from './lib/constant-file';

async function parseSamplingControlFile(filename : string) : Promise<[Set<string>, Set<string>, Set<string>, Set<string>|undefined, Set<string>|undefined]> {
    const functionBlackList = new Set<string>();
    const deviceBlackList = new Set<string>();
    const functionHighValueList = new Set<string>();
    let functionWhiteList : Set<string>|undefined;
    let deviceWhiteList : Set<string>|undefined;

    if (!filename)
        return [functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList];

    const file = fs.createReadStream(filename);
    file.setEncoding('utf8');
    const input = byline(file);

    input.on('data', (line : string) => {
        if (/^\s*(#|$)/.test(line))
            return;

        const [attribute, functionName] = line.trim().split('\t');

        switch (attribute) {
        case 'whitelist':
            if (functionName.endsWith('.*')) {
                if (!deviceWhiteList)
                    deviceWhiteList = new Set;
                deviceWhiteList.add(functionName);
            } else {
                if (!functionWhiteList)
                    functionWhiteList = new Set;
                functionWhiteList.add(functionName);
            }
            break;
        case 'blacklist':
            if (functionName.endsWith('.*'))
                deviceBlackList.add(functionName);
            else
                functionBlackList.add(functionName);
            break;
        case 'high':
            // ignore high value whole devices
            if (!functionName.endsWith('.*'))
                functionHighValueList.add(functionName);
            break;
        case 'low':
            // ignore low value entry (everything is low-value by default)
            break;
        default:
            throw new Error(`Invalid function attribute ${attribute}`);
        }
    });

    return new Promise((resolve, reject) => {
        input.on('end', () => resolve([functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList]));
        input.on('error', reject);
    });
}

const ENTITY_MATCH_REGEX = /^([A-Z].*)_[0-9]+$/;

class ContextSourceLoader extends Stream.Writable {
    private _buffer : Map<string, string[]>;

    constructor() {
        super({ objectMode: true });

        this._buffer = new Map;
    }

    // renumber entities so they are assigned in program order rather than sentence order
    private _normalizeEntities(ex : SentenceExample) {
        const renameMap : Record<string, string> = Object.create(null);
        const countMap : Record<string, number> = Object.create(null);

        let inString = false;
        let anyRename = false;
        const newCode = [];
        const code = String(ex.target_code).split(' ');
        for (let i = 0; i < code.length; i++) {
            const token = code[i];
            if (token === '"') {
                inString = !inString;
                newCode.push(token);
                continue;
            }
            if (inString) {
                newCode.push(token);
                continue;
            }
            if (token in renameMap) {
                newCode.push(renameMap[token]);

                // if we renamed a number into a measure, skip the unit
                if (token.startsWith('NUMBER_') && renameMap[token].startsWith('MEASURE_'))
                    i++;
            }

            const match = ENTITY_MATCH_REGEX.exec(token);
            if (match === null) {
                newCode.push(token);
                continue;
            }

            let [,type,] = match;

            // collapse NUMBER_ followed by unit into measure or duration
            if (type === 'NUMBER' && i < code.length-1 && code[i+1].startsWith('unit:')) {
                const unit = code[i+1].substring('unit:'.length);
                const baseunit = new ThingTalk.Type.Measure(unit).unit;
                if (baseunit === 'ms')
                    type = 'DURATION';
                else
                    type = 'MEASURE_' + baseunit;
                // skip the unit
                i++;
            }

            let newIdx;
            if (type in countMap)
                newIdx = countMap[type] + 1;
            else
                newIdx = 0;
            countMap[type] = newIdx;

            const newToken = type + '_' + newIdx;
            if (newToken !== token)
                anyRename = true;
            renameMap[token] = newToken;
            newCode.push(newToken);
        }
        ex.target_code = newCode.join(' ');
        if (!anyRename)
            return;
        ex.preprocessed = ex.preprocessed.split(' ').map((token) => {
            if (token in renameMap)
                return renameMap[token];
            else
                return token;
        }).join(' ');
    }

    _write(ex : SentenceExample, encoding : BufferEncoding, callback : () => void) {
        /*let yes = false;
        if (ex.target_code === 'now => @com.foradb.findBP param:edate:Date = end_of unit:week - DURATION_1 param:patient:String = QUOTED_STRING_0 param:sdate:Date = end_of unit:mon + DURATION_0 => notify')
            yes = true;*/
        this._normalizeEntities(ex);
        //if (yes)
        //    console.log(ex);

        if (this._buffer.has(String(ex.target_code)))
            this._buffer.get(String(ex.target_code))!.push(ex.preprocessed);
        else
            this._buffer.set(String(ex.target_code), [ex.preprocessed]);
        callback();
    }

    _finish(callback : () => void) {
        callback();
    }

    async read() {
        await StreamUtils.waitFinish(this);
        return this._buffer;
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('sample', {
        add_help: true,
        description: "Choose which sentences to paraphrase, given a synthetic set."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to JSON file containing signature, type and mixin definitions.'
    });
    parser.add_argument('--constants', {
        required: true,
        help: 'TSV file containing constant values to use.'
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to augment (in TSV format); use - for standard input'
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
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('--context-source', {
        help: 'Source dataset from where contexts were extracted; used to choose a context sentence for each context.',
    });
    parser.add_argument('--sampling-strategy', {
        required: false,
        choices: ['byCode', 'bySentence', 'bySignature'],
        help: 'Which sampling strategy to use (defaults: bySignature).'
    });
    parser.add_argument('--sampling-control', {
        required: false,
        help: 'TSV file controlling sampling based on functions in the programs. Defaults to treating all functions equally.'
    });
    parser.add_argument('--compound-only', {
        help: 'Keep only compound programs. (False if omitted)',
        action: 'store_true'
    });

    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: true
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
    parser.add_argument('--random-seed', {
        default: 'almond is awesome',
        help: 'Random seed'
    });
}

export async function execute(args : any) {
    let contexts;
    if (args.contextual) {
        if (!args.context_source)
            throw new Error(`--context-source is required if --contextual`);

        contexts = await readAllLines([fs.createReadStream(args.context_source)])
            .pipe(new DatasetParser({ preserveId: true }))
            .pipe(new ContextSourceLoader())
            .read();
    }

    const constants = await parseConstantFile(args.locale, args.constants);
    const [functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList] =
        await parseSamplingControlFile(args.sampling_control);

    const tpClient = new Tp.FileClient({
        locale: args.locale,
        thingpedia: args.thingpedia
    });
    const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);

    const options = {
        rng: seedrandom.alea(args.random_seed),
        locale: args.locale,
        timezone: args.timezone,

        samplingStrategy: args.sampling_strategy,
        functionBlackList,
        deviceBlackList,
        functionHighValueList,
        functionWhiteList,
        deviceWhiteList,
        contexts,

        compoundOnly: !!args.compound_only,
        debug: args.debug
    };

    readAllLines(args.input_file)
        .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true }))
        .pipe(new SentenceSampler(tpClient, schemaRetriever, constants, options))
        .pipe(csvstringify({ header: true, delimiter: '\t' }))
        .pipe(args.output);

    return new Promise((resolve, reject) => {
        args.output.on('finish', resolve);
        args.output.on('error', reject);
    });
}
