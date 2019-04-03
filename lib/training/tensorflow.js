// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const path = require('path');
const util = require('util');
const child_process = require('child_process');
const fs = require('fs');

const BaseTrainingJob = require('./base_training_job');

const { execCommand, safeMkdir, safeRmdir } = require('./exec-utils');

const GENIE_PARSER_PATH = path.resolve(process.env.GENIE_PARSER_PATH || '/opt/genie-parser');
const GENIE_PARSER_PYTHON = process.env.GENIE_PARSER_PYTHON || 'python3';

const DEFAULT_TRAINING_CONFIG = {
    train_steps: 400000,
    thingpedia_snapshot: '-1',
    model: 'genie_copy_seq2seq',
    hparams_set: 'lstm_genie',
    hparams_overrides: '',
    decode_hparams: "beam_size=20,return_beams=true",
    problem: 'semparse_thingtalk_noquote',
    eval_early_stopping_metric: 'metrics-semparse_thingtalk_noquote/accuracy',
    eval_early_stopping_metric_minimize: false
};

module.exports = class TensorflowTrainingJob extends BaseTrainingJob {
    constructor(options) {
        super(options);

        this._config = {};
        Object.assign(this._config, DEFAULT_TRAINING_CONFIG);
        if (options.config)
            Object.assign(this._config, options.config);
    }

    get config() {
        return this._config;
    }

    async _datagen() {
        await execCommand(this, GENIE_PARSER_PYTHON, [
            path.resolve(GENIE_PARSER_PATH, 'genie-datagen'),
            '--data_dir', this.workdir,
            '--src_data_dir', this.datadir,
            '--problem', this.config.problem,
            '--thingpedia_snapshot', this.config.thingpedia_snapshot,
        ]);
    }

    async _train() {
        await execCommand(this, GENIE_PARSER_PYTHON, [
            path.resolve(GENIE_PARSER_PATH, 'genie-trainer'),
            '--data_dir', this.workdir,
            '--problem', this.config.problem,
            '--model', this.config.model,
            '--hparams_set', this.config.hparams_set,
            '--hparams', this.config.hparams_overrides,
            '--output_dir', path.resolve(this.workdir, 'model'),
            '--train_steps', this.config.train_steps,
            '--export_saved_model',
            '--eval_early_stopping_metric', this.config.eval_early_stopping_metric,
            `--${this.config.eval_early_stopping_metric_minimize ? '' : 'no'}eval_early_stopping_metric_minimize`,
            '--decode_hparams', this.config.decode_hparams
        ], (line) => {
            const match = / step = ([0-9]+) /.exec(line);
            if (match !== null)
                this.progress = parseFloat(match[1])/this.config.train_steps;
        });
        if (this._killed)
            return;

        await this._extractEvalMetrics();
        if (this._killed)
            return;
        await this._findBestModel();
    }

    async _findBestModel() {
        // remove the output directory again
        // this ensures nothing weird happened between when we started and now
        if (this.outputdir)
            await safeRmdir(this.outputdir);

        const filenames = await util.promisify(fs.readdir)(path.resolve(this.workdir, 'model/export/best'));
        filenames.sort((a, b) => {
            // sort numerically, largest first
            return parseInt(b) - parseInt(a);
        });
        if (filenames.length === 0)
            throw new Error("Did not produce a trained model");

        const bestModel = filenames[0];
        this.bestmodeldir = path.resolve(this.workdir, 'model/export/best', bestModel);

        await util.promisify(fs.writeFile)(path.resolve(this.bestmodeldir, 'model.json'), JSON.stringify({
            "problem": this.config.problem,
            "model": this.config.model,
            "hparams_set": this.config.hparams_set,
            "hparams_overrides": this.config.hparams_overrides,
            "decode_hparams": this.config.decode_hparams
        }));
        if (this._killed)
            return;

        // copy the best model into the output directory
        if (this.outputdir)
            await execCommand(this, 'cp', ['-T', '-r', this.bestmodeldir, this.outputdir]);

    }

    async _extractEvalMetrics() {
        let { stdout, stderr } = await util.promisify(child_process.execFile)(GENIE_PARSER_PYTHON, [
            path.resolve(GENIE_PARSER_PATH, 'genie-print-metrics'),
            '--output_dir', path.resolve(this.workdir, 'model'),
            '--eval_early_stopping_metric', this.config.eval_early_stopping_metric,
            `--${this.config.eval_early_stopping_metric_minimize ? '' : 'no'}eval_early_stopping_metric_minimize`,
        ]);

        stdout = stdout.trim();
        if (!stdout) {
            if (stderr)
                throw new Error(stderr);
            else
                throw new Error(`Failed to print metrics`);
        }

        this.metrics = {};
        const prefix = 'metrics-' + this.config.problem + '/';
        for (let line of stdout.split('\n')) {
            let [key, value] = line.split('=');
            key = key.trim();
            if (key.startsWith(prefix))
                key = key.substring(prefix.length);
            value = parseFloat(value.trim());
            this.metrics[key] = value;
        }
    }

    async train() {
        // remove the output directory first
        // this will complain loudly if the directory is not empty
        if (this.outputdir)
            await safeRmdir(this.outputdir);
        await safeMkdir(this.workdir);
        if (this._killed)
            return;

        await this._datagen();
        if (this._killed)
            return;
        await this._train();
    }
};
