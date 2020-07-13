// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
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
"use strict";

const util = require('util');
const fs = require('fs');
const path = require('path');

const Training = require('../lib/training');
const ProgressBar = require('./lib/progress_bar');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('train', {
            addHelp: true,
            description: "Train a model on a Genie-generated dataset."
        });
        parser.addArgument('--datadir', {
            required: true,
            help: "Directory containing the train/eval/test set to train with."
        });
        parser.addArgument('--outputdir', {
            required: true,
            help: "Directory where the final trained model will be placed."
        });
        parser.addArgument('--workdir', {
            required: true,
            help: "Temporary directory for preprocessed datasets, checkpoints and Tensorboard files."
        });
        parser.addArgument('--config-file', {
            required: false,
            help: "JSON configuration file setting hyper-parameters and parser options."
        });
        parser.addArgument('--backend', {
            required: false,
            defaultValue: Training.DEFAULT_BACKEND,
            choices: Object.keys(Training.BACKENDS),
            help: "Which training backend to use (experimental)"
        });

        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
    },

    async execute(args) {
        let config = {};
        if (args.config_file)
            config = JSON.parse(await util.promisify(fs.readFile)(args.config_file));

        const job = Training.createJob({
            backend: args.backend,
            config,

            datadir: args.datadir,
            workdir: args.workdir,
            outputdir: args.outputdir,

            debug: !!args.debug
        });

        if (!args.debug) {
            const progbar = new ProgressBar(1);
            job.on('progress', (value) => {
                progbar.update(value);
            });

            // issue an update now to show the progress bar
            progbar.update(0);
        }

        await job.train();

        console.log('Training complete');
        console.log('Evaluation result (on validation set)');
        for (let key in job.metrics)
            console.log(` ${key} = ${job.metrics[key]}`);
        await util.promisify(fs.writeFile)(path.resolve(args.workdir, 'eval-metrics.json'),
            JSON.stringify(job.metrics, undefined, 2));
    }
};
