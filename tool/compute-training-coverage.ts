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
// Author: Silei Xu <silei@cs.stanford.edu>

import * as argparse from 'argparse';
import * as fs from 'fs';
import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';

import * as Utils from '../lib/utils/misc-utils';
import { requoteProgram } from '../lib/dataset-tools/requoting';
import { readAllLines } from './lib/argutils';
import { DatasetParser } from '../lib/dataset-tools/parsers';
import * as ThingTalkUtils from '../lib/utils/thingtalk';

async function normalize(preprocessed : string, target_code : string, tpClient : Tp.BaseClient, schemas : ThingTalk.SchemaRetriever, timezone : string) : Promise<string> {
    const entities = Utils.makeDummyEntities(preprocessed);
    const sequence = target_code.split(' ');
    const parsed = await ThingTalkUtils.parsePrediction(sequence, entities, {
        timezone: timezone,
        thingpediaClient: tpClient,
        schemaRetriever: schemas
    }, true);
    const normalized = ThingTalkUtils.serializeNormalized(parsed);
    return normalized.join(' ');
}


export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('compute-training-coverage', {
        add_help: true,
        description: "Given a evaluation set, compute the percent of programs appeared in training set"
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
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
    parser.add_argument('--training-set', {
        required: true,
        type: fs.createReadStream,
        help: 'Path to the file containing the training data (in TSV format: id, utterance, thingtalk)'
    });
    parser.add_argument('--evaluation-set', {
        required: true,
        type: fs.createReadStream,
        help: `Path to the file containing the evaluation data (in TSV format: id, utterance, thingtalk)`
    });
}

export async function execute(args : any) {
    const tpClient = new Tp.FileClient(args);
    const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);

    let trainingSize = 0;
    const trainingPrograms = new Map<string, number>(); // counter of unique programs in training set
    args.training_set.setEncoding('utf8');
    const training = await readAllLines([args.training_set])
        .pipe(new DatasetParser({ preserveId: true }));
    for await (const line of training) {
        const normalized = await normalize(line.preprocessed, line.target_code, tpClient, schemas, args.timezone);
        const requoted = Array.from(requoteProgram(normalized)).join(' ');
        trainingPrograms.set(requoted, (trainingPrograms.get(requoted) || 0) + 1);
        trainingSize += 1;
    }

    let newCount = 0;
    const newPrograms = new Set<string>();

    let evaluationSize = 0;
    const evaluationPrograms = new Map<string, number>(); // counter of unique programs in evaluation set
    args.evaluation_set.setEncoding('utf8');
    const evaluation = await readAllLines([args.evaluation_set])
        .pipe(new DatasetParser({ preserveId: true, parseMultiplePrograms: true }));
    for await (const line of evaluation) {
        const candidates = line.target_code;
        let covered = false;
        let requoted = '';
        for (const thingtalk of candidates) {
            const normalized = await normalize(line.preprocessed, thingtalk, tpClient, schemas, args.timezone);
            requoted = Array.from(requoteProgram(normalized)).join(' ');
            if (trainingPrograms.has(requoted)) {
                covered = true;
                break;
            }
        }
        if (!covered) {
            newPrograms.add(requoted);
            newCount += 1;
        }
        evaluationPrograms.set(requoted, (evaluationPrograms.get(requoted) || 0) + 1);
        evaluationSize += 1;
    }

    console.log(`${trainingPrograms.size} unique programs in training set`);
    console.log(`${evaluationPrograms.size} unique programs in evaluation set`);
    console.log(`${newPrograms.size} programs are not covered.`);
    const coverage = (newCount * 100 / evaluationSize).toFixed(2);
    console.log(`In total, ${coverage}% (${newCount} / ${evaluationSize}) evaluation examples are not covered.`);

    console.log(`% in evaluation set\t% in training set\tprogram`);
    let sumPercentInTraining = 0;
    for (const program in evaluationPrograms) {
        const percentInEvaluation = ((evaluationPrograms.get(program) || 0) * 100 / evaluationSize);
        const percentInTraining = ((trainingPrograms.get(program) || 0) * 100 / trainingSize);
        sumPercentInTraining += percentInTraining;
        console.log(`${percentInEvaluation.toFixed(2)}%\t${percentInTraining.toFixed(2)}%\t${program}`);
    }
    console.log(`100.00%\t${sumPercentInTraining.toFixed(2)}%`);
}
