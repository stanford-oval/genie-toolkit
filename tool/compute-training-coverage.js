// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const fs = require('fs');
const ThingTalk = require('thingtalk');
const Tp = require('thingpedia');

const Utils = require('../lib/utils/misc-utils');
const { requoteProgram } = require('../lib/dataset-tools/requoting');
const { readAllLines } = require('./lib/argutils');
const { DatasetParser } = require('../lib/dataset-tools/parsers');

async function normalize(preprocessed, target_code, schemas) {
    const entities = Utils.makeDummyEntities(preprocessed);
    const sequence = target_code.split(' ');
    const parsed = ThingTalk.NNSyntax.fromNN(sequence, entities);
    await parsed.typecheck(schemas);
    const normalized = ThingTalk.NNSyntax.toNN(parsed, preprocessed, {}, {
        allocateEntities: true,
        typeAnnotations: false
    });
    return normalized.join(' ');
}


module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('compute-training-coverage', {
            addHelp: true,
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
        parser.addArgument('--training-set', {
            required: true,
            type: fs.createReadStream,
            help: 'Path to the file containing the training data (in TSV format: id, utterance, thingtalk)'
        });
        parser.addArgument('--evaluation-set', {
            required: true,
            type: fs.createReadStream,
            help: `Path to the file containing the evaluation data (in TSV format: id, utterance, thingtalk)`
        });
    },

    async execute(args) {
        const tpClient = new Tp.FileClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);

        let trainingSize = 0;
        const trainingPrograms = new Map(); // counter of unique programs in training set
        args.training_set.setEncoding('utf8');
        const training = await readAllLines([args.training_set])
            .pipe(new DatasetParser({ preserveId: true }));
        for await (const line of training) {
            const normalized = await normalize(line.preprocessed, line.target_code, schemas);
            const requoted = Array.from(requoteProgram(normalized)).join(' ');
            trainingPrograms[requoted] = (trainingPrograms[requoted] || 0) + 1;
            trainingSize += 1;
        }

        let newCount = 0;
        const newPrograms = new Set();

        let evaluationSize = 0;
        const evaluationPrograms = {}; // counter of unique programs in evaluation set
        args.evaluation_set.setEncoding('utf8');
        const evaluation = await readAllLines([args.evaluation_set])
            .pipe(new DatasetParser({ preserveId: true, parseMultiplePrograms: true }));
        for await (const line of evaluation) {
            const candidates = line.target_code;
            let covered = false;
            let requoted;
            for (let thingtalk of candidates) {
                const normalized = await normalize(line.preprocessed, thingtalk, schemas);
                requoted = Array.from(requoteProgram(normalized)).join(' ');
                if (requoted in trainingPrograms) {
                    covered = true;
                    break;
                }
            }
            if (!covered) {
                newPrograms.add(requoted);
                newCount += 1;
            }
            evaluationPrograms[requoted] = (evaluationPrograms[requoted] || 0) + 1;
            evaluationSize += 1;
        }

        console.log(`${Object.keys(trainingPrograms).length} unique programs in training set`);
        console.log(`${Object.keys(evaluationPrograms).length} unique programs in evaluation set`);
        console.log(`${newPrograms.size} programs are not covered.`);
        const coverage = (newCount * 100 / evaluationSize).toFixed(2);
        console.log(`In total, ${coverage}% (${newCount} / ${evaluationSize}) evaluation examples are not covered.`);

        console.log(`% in evaluation set\t% in training set\tprogram`);
        let sumPercentInTraining = 0;
        for (let program in evaluationPrograms) {
            const percentInEvaluation = (evaluationPrograms[program] * 100 / evaluationSize);
            const percentInTraining = ((trainingPrograms[program] || 0) * 100 / trainingSize);
            sumPercentInTraining += percentInTraining;
            console.log(`${percentInEvaluation.toFixed(2)}%\t${percentInTraining.toFixed(2)}%\t${program}`);
        }
        console.log(`100.00%\t${sumPercentInTraining.toFixed(2)}%`);
    }
};
