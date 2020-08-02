// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Silei Xu <silei@cs.stanford.edu>
"use strict";

const fs = require('fs');
const csvparse = require('csv-parse');
const { requoteProgram } = require('../lib/dataset-tools/requoting');

function waitEnd(stream) {
    return new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
    });
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('compute-synthetic-coverage', {
            addHelp: true,
            description: "Given a evaluation set, compute the percent of programs appeared in synthetic sentence"
        });
        parser.addArgument('--synthetic-set', {
            required: true,
            type: fs.createReadStream,
            help: 'Path to the file containing the synthetic data (in TSV format: id, utterance, thingtalk)'
        });
        parser.addArgument('--evaluation-set', {
            required: true,
            type: fs.createReadStream,
            help: `Path to the file containing the evaluation data (in TSV format: id, utterance, thingtalk)`
        });
    },

    async execute(args) {
        let syntheticSize = 0;
        const syntheticPrograms = {}; // counter of unique programs in synthetic set
        args.synthetic_set.setEncoding('utf8');
        const synthetic = args.synthetic_set.pipe(csvparse({ relax: true, delimiter: '\t' }));
        synthetic.on('data', (line) => {
            const requoted = Array.from(requoteProgram(line[2])).join(' ');
            const requotedNoType = requoted.replace(/(param:[a-zA-Z_]+):\S+/g, '$1');
            syntheticPrograms[requotedNoType] = (syntheticPrograms[requotedNoType] || 0) + 1;
            syntheticSize += 1;
        });
        await waitEnd(synthetic);

        let newCount = 0;
        const newPrograms = new Set();

        let evaluationSize = 0;
        const evaluationPrograms = {}; // counter of unique programs in evaluation set
        args.evaluation_set.setEncoding('utf8');
        const evaluation = args.evaluation_set.pipe(csvparse({ relax: true, delimiter: '\t', relax_column_count: true }));
        evaluation.on('data', (line) => {
            const candidates = line.slice(2);
            let covered = false;
            let requoted, requotedNoType;
            for (let thingtalk of candidates) {
                requoted = Array.from(requoteProgram(thingtalk)).join(' ');
                requotedNoType = requoted.replace(/(param:[a-zA-Z_]+):\S+/g, '$1');
                if (requotedNoType in syntheticPrograms) {
                    covered = true;
                    break;
                }
            }
            if (!covered) {
                newPrograms.add(requotedNoType);
                newCount += 1;
            }
            evaluationPrograms[requotedNoType] = (evaluationPrograms[requotedNoType] || 0) + 1;
            evaluationSize += 1;
        });
        await waitEnd(evaluation);

        console.log(`${Object.keys(syntheticPrograms).length} unique programs in synthetic set`);
        console.log(`${Object.keys(evaluationPrograms).length} unique programs in evaluation set`);
        console.log(`${newPrograms.size} programs are not covered.`);
        const coverage = (newCount * 100 / evaluationSize).toFixed(2);
        console.log(`In total, ${coverage}% (${newCount} / ${evaluationSize}) evaluation examples are not covered.`);

        console.log(`% in evaluation set\t% in synthetic set\tprogram`);
        let sumPercentInSynthetic = 0;
        for (let program in evaluationPrograms) {
            const percentInEvaluation = (evaluationPrograms[program] * 100 / evaluationSize);
            const percentInSynthetic = ((syntheticPrograms[program] || 0) * 100 / syntheticSize);
            sumPercentInSynthetic += percentInSynthetic;
            console.log(`${percentInEvaluation.toFixed(2)}%\t${percentInSynthetic.toFixed(2)}%\t${program}`);
        }
        console.log(`100.00%\t${sumPercentInSynthetic.toFixed(2)}%`);
    }
};
