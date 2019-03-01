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
const fs = require('fs');
const byline = require('byline');

const BaseTrainingJob = require('./base_training_job');

const StreamUtils = require('../stream-utils');
const { execCommand, safeMkdir, safeMkdirP, safeRmdir } = require('./exec-utils');

const DECANLP_PATH = path.resolve(process.env.DECANLP_PATH || '/opt/decanlp');
const DECANLP_PYTHON = process.env.DECANLP_PYTHON || 'python3';

const DEFAULT_TRAINING_CONFIG = {
    task_name: 'almond',
    train_iterations: 250000,
    save_every: 5000,
    log_every: 1000,
    train_batch_tokens: 256,
    val_batch_size: 100,
};

module.exports = class DecaNLPTrainingJob extends BaseTrainingJob {
    constructor(options) {
        super(options);

        this._config = {};
        Object.assign(this._config, DEFAULT_TRAINING_CONFIG);
        if (options.config)
            Object.assign(this._config, options.config);

        this._processeddatadir = path.resolve(this.workdir, this._config.task_name, 'en-tt');
    }

    get config() {
        return this._config;
    }

    async _datagen() {
        await safeMkdirP(this._processeddatadir);

        for (let split of ['train', 'test', 'eval']) {
            const input = fs.createReadStream(path.resolve(this.datadir, split + '.tsv'));
            input.setEncoding('utf8');

            // we need to do some gymnastics to handle a non-existent test.tsv correctly,
            // and also pipe into two different files
            await new Promise((resolve, reject) => {
                input.on('error', (e) => {
                    if (e.code === 'ENOENT' && split === 'test')
                        resolve();
                    else
                        reject(e);
                });
                input.on('open', () => {
                    const outsentence = fs.createWriteStream(path.resolve(this._processeddatadir, split + '.en-tt.en'));
                    const outprogram = fs.createWriteStream(path.resolve(this._processeddatadir, split + '.en-tt.tt'));

                    const wrapped = byline(input);
                    wrapped.on('data', (line) => {
                        let [, sentence, program] = line.split('\t');
                        outsentence.write(sentence + '\n');
                        outprogram.write(program + '\n');
                    });
                    wrapped.on('end', () => {
                        outsentence.end();
                        outprogram.end();
                    });

                    resolve(Promise.all([
                        StreamUtils.waitFinish(outsentence),
                        StreamUtils.waitFinish(outprogram)
                    ]));
                });
            });
        }
    }

    async _train() {
        const args = [
            path.resolve(DECANLP_PATH, 'train.py'),
            '--train_tasks', this._config.task_name,
            '--save', path.resolve(this.workdir, 'model'),
            '--cached', path.resolve(this.workdir, 'cache'),
            '--data', this.workdir,
            '--preserve_case',
        ];
        if (process.env.DECANLP_EMBEDDINGS)
            args.push('--embeddings', process.env.DECANLP_EMBEDDINGS);
        else
            args.push('--embeddings', path.resolve(this.workdir, 'embeddings'));
        for (let key in this._config) {
            if (key === 'thingpedia_snapshot' || key === 'synthetic_depth' || key === 'task_name')
                continue;
            if (typeof this._config[key] === 'boolean') {
                if (this._config[key])
                    args.push('--' + key);
            } else {
                args.push('--' + key, String(this._config[key]));
            }
        }

        this.metrics = {};
        await execCommand(this, DECANLP_PYTHON, args, (line) => {
            const match = /train_[a-z]+:([0-9]+)\/[0-9]+:val_[a-z]+:(.*)$/.exec(line);
            if (match === null)
                return;
            this.progress = parseFloat(match[1])/this._config.train_iterations;
            for (let metric of match[2].split(':')) {
                 let [key, value] = metric.split('_');
                 this.metrics[key] = parseFloat(value);
            }
        });
        if (this._killed)
            return;

        await this._findBestModel();
    }

    async _findBestModel() {
        // TODO
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

    async _eval(useTestSet) {
        // TODO
    }

    async evaluate(useTestSet) {
        if (!fs.existsSync(this.workdir))
            await this._datagen();

        return this._eval();
    }
};
