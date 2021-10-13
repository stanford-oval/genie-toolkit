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
// Author: Silei Xu <silei@cs.stanford.edu>

import assert from 'assert';
import * as fs from 'fs';
import * as argparse from 'argparse';
import * as readline from 'readline';
import * as levenshtein from 'fastest-levenshtein';
import JSONStream from 'JSONStream';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import { Ast, Type } from 'thingtalk';
import * as ThingTalkUtils from '../../../lib/utils/thingtalk';
import { argnameFromLabel } from './utils';

async function loadJson(file : fs.ReadStream) : Promise<Map<string, string>> {
    const data = new Map();
    const pipeline = file.pipe(JSONStream.parse('$*'));
    await new Promise((resolve, reject) => {
        pipeline.on('data', (item) => data.set(item.key, item.value));
        pipeline.on('end', resolve);
        pipeline.on('error', reject);
    });
    return data;
}

async function* zip(stream1 : readline.Interface, stream2 : readline.Interface) : AsyncIterable<[any, any]> {
    const iter1 = stream1[Symbol.asyncIterator]();
    const iter2 = stream2[Symbol.asyncIterator]();
    let [{ value: v1, done: d1 }, { value: v2, done: d2 }] = await Promise.all([iter1.next(), iter2.next()]);
    while (!d1 && !d2) {
        yield [v1, v2];
        [{ value: v1, done: d1 }, { value: v2, done: d2 }] = await Promise.all([iter1.next(), iter2.next()]);
    }
}

function extractEntityType(type : Type) : string|null {
    if (type instanceof Type.Entity)
        return type.type;
    if (type instanceof Type.Array) 
        return extractEntityType(type.elem as Type);
    return null;
}

function extractEntityValues(value : Ast.Value) : Ast.EntityValue[] {
    if (value instanceof Ast.ArrayValue)
        return value.value.map(extractEntityValues).flat();
    if (value instanceof ThingTalk.Ast.EntityValue && value.value)
        return [value];
    return [];
}

function removeQid(example : string, qid : string) : string {
    const re = new RegExp(`" ${qid} "`, 'g');
    return example.replace(re, "null");
}

const counter = {
    correct: 0, // all qids in the example are correctly predicted
    ambiguous: 0, // there exists one entity that the predicted QID is wrong, but type is correct
    incorrect: 0, // there exists one entity that the predicted QID and type are both wrong
    missing: 0, // none 
    SyntaxError: 0,
};

async function postprocess(schemas : ThingTalk.SchemaRetriever, 
                           bootlegTypes : fs.ReadStream,
                           bootlegTypeCanonincals : fs.ReadStream,
                           input : { examples : fs.ReadStream, bootleg : fs.ReadStream }, 
                           output : { examples : fs.WriteStream, bootleg : fs.WriteStream }) {
    const types = await loadJson(bootlegTypes);
    const typeCanonicals = await loadJson(bootlegTypeCanonincals);
    const rlExamples = readline.createInterface({ input: input.examples });
    const rlBootleg = readline.createInterface({ input: input.bootleg });
    for await (const [example, bootleg] of zip(rlExamples, rlBootleg)) {
        let updatedExample = example;
        const parsed = JSON.parse(bootleg);
        const qids : string[] = parsed.qids;
        // if no qid is predicted, remove qid in thingtalk
        if (qids.length === 0) {
            updatedExample = example.replace(/" Q[0-9]* "/g, "null");
            output.examples.write(updatedExample + '\n');
            output.bootleg.write(bootleg + '\n');
            if (updatedExample === example)
                counter.correct += 1;
            else 
                counter.missing += 1;
            continue;
        }
        const mentions : string[] = parsed.aliases;
        const thingtalk = example.split('\t')[2];
        try {
            const program = await ThingTalkUtils.parse(thingtalk, schemas);
            let ambiguous = false;
            let hasWrongQid = false;
            let hasMissing = false;
            for (const slot of program.iterateSlots2()) {
                if (!(slot instanceof ThingTalk.Ast.FilterSlot))
                    continue;
                const type = extractEntityType(slot.type);
                if (!type) 
                    continue;
                const values = extractEntityValues(slot.get());

                // if qid is correctly predicted, do nothing
                for (const value of values) {
                    if (!value.value || !value.display)
                        continue;
                    const qid = value.value.trim();
                    const display = value.display.trim();
                    const canonical = display.startsWith('the ') ? display.slice('the '.length) : display;
                    const match = levenshtein.closest(canonical, mentions);
                    if (levenshtein.distance(match, canonical) / canonical.length > 0.3) {
                        // even the closest is a bad match
                        hasMissing = true;
                        updatedExample = removeQid(updatedExample, qid);
                        continue;
                    }
                    const predictedQid = qids[mentions.indexOf(match)];
                    if (predictedQid !== qid) {
                        const predictedTypeQids = types.get(predictedQid);
                        assert(predictedTypeQids && predictedTypeQids.length > 0);
                        const predictedType = argnameFromLabel(typeCanonicals.get(predictedTypeQids[0])!);
                        if (`org.wikidata:${predictedType}` === type) {
                            ambiguous = true;
                        } else {
                            const predictedParentTypes = await schemas.getEntityParents(`org.wikidata:${predictedType}`);
                            if (predictedParentTypes.includes(type)) {
                                ambiguous = true;
                            } else {
                                hasWrongQid = true;
                                updatedExample = removeQid(updatedExample, qid); 
                            }
                        }
                    }
                }
            }

            if (ambiguous) {
                // drop the example if ambiguous
                counter.ambiguous += 1;
            } else {
                if (hasMissing) 
                    counter.missing += 1;
                else if (hasWrongQid) 
                    counter.incorrect += 1;
                else 
                    counter.correct += 1;
                // write to the updated file
                output.examples.write(updatedExample + '\n');
                output.bootleg.write(bootleg + '\n');
            }
        } catch(e) {
            // happens when an entity parameter has no values available
            counter.SyntaxError += 1;
        }
    }

    const total = counter.ambiguous + counter.missing + counter.incorrect + counter.correct + counter.SyntaxError;
    console.log(`Total: ${total - counter.ambiguous - counter.SyntaxError} / ${total} examples`); 
    console.log(`Dropped: ${(counter.ambiguous/total*100).toFixed(2)}% are ambiguous, ${(counter.SyntaxError/total*100).toFixed(2)}% have syntax error`);
    console.log(`Updated: ${(counter.missing/total*100).toFixed(2)}% missed the entity, ${(counter.incorrect/total*100).toFixed(2)}% predicted wrong entity`);
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('wikidata-postprocess-data', {
        add_help: true,
        description: `Post-process train/dev sets with bootleg information`,
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--entities', {
        required: false,
        help: 'Path to JSON file containing entity type definitions.'
    });
    parser.add_argument('--bootleg-output', {
        required: true,
        type: fs.createReadStream,
        help: 'Path to the bootleg output jsonl file, containing the QIDs predicted'
    });
    parser.add_argument('--bootleg-types', {
        required: true,
        type: fs.createReadStream,
        help: 'Path to the bootleg file with mapping from QIDs to types'
    });
    parser.add_argument('--bootleg-type-canonicals', {
        required: true,
        type: fs.createReadStream,
        help: 'Path to the bootleg file with mapping from type QIDs to their canonical'
    });
    parser.add_argument('examples', {
        type: fs.createReadStream,
        help: 'path to the train or dev file'
    });
    parser.add_argument('--updated-examples', {
        type: fs.createWriteStream,
        help: 'path to the updated train or dev file'
    });
    parser.add_argument('--updated-bootleg-output', {
        type: fs.createWriteStream,
        help: 'path to the updated bootleg output jsonl file'
    });
}

export async function execute(args : any) {
    const tpClient = new Tp.FileClient(args);
    const schemas = new ThingTalk.SchemaRetriever(tpClient);
    await postprocess(schemas, 
        args.bootleg_types, 
        args.bootleg_type_canonicals, 
        { examples: args.examples, bootleg: args.bootleg_output }, 
        { examples: args.updated_examples, bootleg: args.updated_bootleg_output });
}