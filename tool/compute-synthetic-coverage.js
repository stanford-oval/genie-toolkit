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
        const programs = new Set();
        args.synthetic_set.setEncoding('utf8');
        const synthetic = args.synthetic_set.pipe(csvparse({ relax: true, delimiter: '\t' }));
        synthetic.on('data', (line) => {
            const requoted = Array.from(requoteProgram(line[2])).join(' ');
            programs.add(requoted);
        });
        await waitEnd(synthetic);

        let newCount = 0;
        let totalCount = 0;
        const newPrograms = new Set();
        args.evaluation_set.setEncoding('utf8');
        const evaluation = args.evaluation_set.pipe(csvparse({ relax: true, delimiter: '\t' }));
        evaluation.on('data', (line) => {
            const requoted = Array.from(requoteProgram(line[2])).join(' ');
            if (!programs.has(requoted)) {
                newPrograms.add(requoted);
                newCount += 1;
            }
            totalCount += 1;
        });
        await waitEnd(evaluation);

        console.log(`${newCount / totalCount * 100}% (${newCount} / ${totalCount}) programs are not covered:`);
        for (let program of newPrograms)
            console.log(program);
    }
};
