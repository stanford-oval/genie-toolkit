// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const util = require('util');
const fs = require('fs');
const path = require('path');

const Training = require('../lib/training');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate', {
            addHelp: true,
            description: "Evaluate a trained luinet model on a Genie-generated dataset, using the test set."
        });
        parser.addArgument('--datadir', {
            required: true,
            help: "Directory containing the train/eval/test set to evaluate with."
        });
        parser.addArgument('--outputdir', {
            required: true,
            help: "Directory where the trained model can be found."
        });
        parser.addArgument('--workdir', {
            required: true,
            help: "Temporary directory for preprocessed datasets, checkpoints and Tensorboard files."
        });
        parser.addArgument('--config-file', {
            required: false,
            help: "JSON configuration file setting hyper-parameters and luinet options."
        });
        parser.addArgument('--backend', {
            required: false,
            defaultValue: Training.DEFAULT_BACKEND,
            choices: Object.keys(Training.BACKENDS),
            help: "Which training backend to use (experimental)"
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
            outputdir: args.outputdir
        });
        job.on('progress', (value) => {
            console.log(`Progress for evaluation job: ${Math.floor(value*100)}`);
        });

        await job.evaluate(fs.existsSync(path.resolve(args.datadir, 'test.tsv')));
    }
};
