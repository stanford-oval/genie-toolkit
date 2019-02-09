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

const { execCommand } = require('./exec-utils');

const LUINET_PATH = path.resolve(process.env.LUINET_PATH || '/opt/luinet');
const LUINET_PYTHON = path.resolve(process.env.LUINET_PYTHON || 'python3');

const DEFAULT_TRAINING_CONFIG = {
    train_steps: 400000,
    synthetic_depth: 4,
    thingpedia_snapshot: '-1',
    model: 'luinet_copy_seq2seq',
    hparams_set: 'lstm_luinet',
    hparams_overrides: '',
    decode_hparams: "beam_size=20,return_beams=true",
    problem: 'semparse_thingtalk_noquote',
    eval_early_stopping_metric: 'metrics-semparse_thingtalk_noquote/accuracy',
    eval_early_stopping_metric_minimize: false
};

async function safeRmdir(dir) {
    try {
        await util.promisify(fs.rmdir)(dir);
    } catch(e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
}

async function safeMkdir(dir) {
    try {
        await util.promisify(fs.mkdir)(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

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
        await execCommand(this, LUINET_PYTHON, [
            path.resolve(LUINET_PATH, 'luinet-datagen'),
            '--data_dir', this.workdir,
            '--src_data_dir', this.datadir,
            '--problem', this.config.problem,
            '--thingpedia_snapshot', this.config.thingpedia_snapshot,
        ]);
    }

    async _train() {
        await execCommand(this, LUINET_PYTHON, [
            path.resolve(LUINET_PATH, 'luinet-trainer'),
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

        await this._extractEvalMetrics();
        await this._findBestModel();
    }

    async _findBestModel() {
        // remove the output directory again
        // this ensures nothing weird happened between when we started and now
        await safeRmdir(this.outputdir);

        const filenames = await util.promisify(fs.readdir)(path.resolve(this.workdir, 'model/export/best'));
        filenames.sort((a, b) => {
            // sort numerically, largest first
            return parseInt(b) - parseInt(a);
        });
        if (filenames.length === 0)
            throw new Error("Did not produce a trained model");

        const bestModel = filenames[0];
        const bestModelDir = path.resolve(this.workdir, 'model/export/best', bestModel);

        // copy the best model into the output directory
        await execCommand(this, 'cp', ['-T', '-r', bestModelDir, this.outputdir]);

        await util.promisify(fs.writeFile)(path.resolve(this.outputdir, 'model.json'), JSON.stringify({
            "problem": this.config.problem,
            "model": this.config.model,
            "hparams_set": this.config.hparams_set,
            "hparams_overrides": this.config.hparams_overrides,
            "decode_hparams": this.config.decode_hparams
        }));
    }

    async _extractEvalMetrics() {
        let { stdout, stderr } = await util.promisify(child_process.execFile)(LUINET_PYTHON, [
            path.resolve(LUINET_PATH, 'luinet-print-metrics'),
            '--output_dir', path.resolve(this.workdir, 'model'),
            '--eval_early_stopping_metric', this.config.eval_early_stopping_metric,
            `--${this.config.eval_early_stopping_metric_minimize ? '' : 'no'}eval_early_stopping_metric_minimize`,
        ]);

        if (stderr)
            throw new Error(stderr);

        this.metrics = {};
        stdout = stdout.trim();

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
        await safeRmdir(this.outputdir);
        await safeMkdir(this.workdir);

        await this._datagen();
        await this._train();
    }

    async _eval(useTestSet) {
        const args = [
            path.resolve(LUINET_PATH, 'luinet-trainer'),
            '--schedule', 'evaluate',
            '--output_dir', path.resolve(this.workdir, 'model'),
            '--data_dir', path.resolve(this.workdir),
            '--problem', this.config.problem,
            '--model', this.config.model,
            '--hparams_set', this.config.hparams_set,
            '--hparams', this.config.hparams_overrides,
            '--checkpoint_path', path.resolve(this.outputdir, 'variables/variables')
        ];
        if (useTestSet)
            args.push('--eval_use_test_set');

        const metrics = {};
        await execCommand(this, LUINET_PYTHON, args, (line) => {
            // we're looking for a line of the form:
            // INFO:tensorflow:Saving dict for global step 245000: global_step = 245000, loss = 1.3691386, metrics-semparse_posthingtalk_noquote_nospan_notype/accuracy = 0.8319088, metrics-semparse_posthingtalk_noquote_nospan_notype/accuracy_without_parameters = 0.8689459, metrics-semparse_posthingtalk_noquote_nospan_notype/bleu_score = 0.9669696, metrics-semparse_posthingtalk_noquote_nospan_notype/device_accuracy = 0.98575497, metrics-semparse_posthingtalk_noquote_nospan_notype/function_accuracy = 0.96723646, metrics-semparse_posthingtalk_noquote_nospan_notype/grammar_accuracy = 1.0, metrics-semparse_posthingtalk_noquote_nospan_notype/num_function_accuracy = 1.0, metrics-semparse_posthingtalk_noquote_nospan_notype/token_f1_accuracy = 0.9803071

            const match = /^INFO:tensorflow:Saving dict for global step [0-9]+: (.*)$/.exec(line);
            if (match !== null) {
                const entries = match[1].split(',');

                const prefix = 'metrics-' + this.config.problem + '/';
                for (let entry of entries) {
                    entry = entry.trim();
                    let [key, value] = entry.split('=');

                    key = key.trim();
                    value = value.trim();

                    if (key === 'global_step')
                        continue;
                    if (key.startsWith(prefix))
                        key = key.substring(prefix.length);
                    metrics[key] = parseFloat(value);
                }
                this.progress = parseFloat(match[1])/this.config.train_steps;
            }
        });

        return metrics;
    }

    async evaluate(useTestSet) {
        if (!fs.existsSync(this.workdir))
            await this._datagen();

        return this._eval();
    }
};
